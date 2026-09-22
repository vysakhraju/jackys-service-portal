import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DebitNote, DebitNoteStatus } from './entities/debit-note.entity';
import { InventoryReservation, ReservationStatus } from '../inventory/entities/inventory-reservation.entity';
import { SparePart } from '../master-data/entities/spare-part.entity';
import { ServicePriceList } from '../master-data/entities/service-price-list.entity';
import { JobCardsService } from '../job-cards/job-cards.service';
import { JobCardStatus } from '../job-cards/entities/job-card.entity';
import { WarrantyStatus } from '../technician/entities/technician-visit.entity';
import { Appointment, CustomerType, JobType } from '../appointments/entities/appointment.entity';
import { GlLedgerService } from '../gl-ledger/gl-ledger.service';

@Injectable()
export class DebitNotesService {
  constructor(
    @InjectRepository(DebitNote) private debitNoteRepository: Repository<DebitNote>,
    @InjectRepository(InventoryReservation) private reservationRepository: Repository<InventoryReservation>,
    @InjectRepository(SparePart) private sparePartRepository: Repository<SparePart>,
    @InjectRepository(ServicePriceList) private priceListRepository: Repository<ServicePriceList>,
    private jobCardsService: JobCardsService,
    private glLedgerService: GlLedgerService,
  ) {}

  private async generateDebitNoteNumber(): Promise<string> {
    const prefix = 'DN-';
    const last = await this.debitNoteRepository
      .createQueryBuilder('dn')
      .where('dn.debitNoteNumber LIKE :prefix', { prefix: `${prefix}%` })
      .orderBy('dn.debitNoteNumber', 'DESC')
      .getOne();

    let sequence = 1;
    if (last) {
      sequence = parseInt(last.debitNoteNumber.replace(prefix, ''), 10) + 1;
    }
    return `${prefix}${sequence.toString().padStart(4, '0')}`;
  }

  /**
   * Sum of unitCost * quantityReserved across every CONSUMED reservation for this Job
   * Card - what the repair actually cost the company in parts (not the customer-facing
   * unitPriceB2B/B2C).
   */
  private async computeSparePartsCost(jobCardId: string): Promise<number> {
    const consumed = await this.reservationRepository.find({
      where: { jobCardId, status: ReservationStatus.CONSUMED },
    });
    let total = 0;
    for (const reservation of consumed) {
      const sparePart = await this.sparePartRepository.findOne({ where: { id: reservation.sparePartId } });
      total += Number(sparePart?.unitCost ?? 0) * reservation.quantityReserved;
    }
    return Math.round(total * 100) / 100;
  }

  /**
   * Price List rebuild (2026-09-22, Phase 3) changed the row shape to Appliance
   * Category x Job Type (dropping the loose model text field the original design used),
   * so this now resolves the interdepartment labor rate the same way the rest of the app
   * resolves a Price List row: via the appointment's linked ApplianceModel.category
   * (req. 1e's proper FK, not the legacy modelNumber string) crossed with the
   * appointment's own jobType. `warrantyLaborCost` is the correct column for this call
   * site specifically - getOrCreateForJobCard already only reaches here for
   * WarrantyStatus.IN_WARRANTY jobs (see the check above), so "labor cost while under
   * warranty" is exactly the interdepartment recharge this Debit Note is for.
   *
   * Billing logic + Billing Channel routing (2026-09-22, Phase 4): when the matched row
   * has a Billing Channel configured, that channel's own `billingChannelRate` overrides
   * the plain `warrantyLaborCost` - Finance needs to see which named interdepartment
   * channel a recharge actually ran through, and at what rate, rather than always the
   * generic one. billingChannelId/Name below are only ever set in that case.
   *
   * Both failure modes below throw rather than silently charging 0 labor - a silent 0
   * would understate every interdepartment recharge and is exactly the kind of gap a
   * real Finance audit would flag, so these are hard stops instead: (1) the model has no
   * Category set yet (still a known, nullable-by-design gap from #301 - see
   * ApplianceModel's own doc comment); (2) a Category resolves but no matching, active
   * Price List row exists for it.
   */
  private async resolveLaborCost(
    appointment: Appointment | null | undefined,
  ): Promise<{ laborCost: number; billingChannelId: string | null; billingChannelName: string | null }> {
    const category = appointment?.applianceModel?.category ?? null;
    if (!category) {
      throw new BadRequestException(
        "This appointment's Appliance Model has no Category set (or no model is linked at all) - set one on the Appliance Model master before a Debit Note can be generated for it.",
      );
    }
    const jobType = appointment?.jobType ?? JobType.REPAIR;
    const priceRow = await this.priceListRepository.findOne({
      where: { category, jobType, isActive: true },
      relations: { billingChannel: true },
    });
    if (!priceRow) {
      throw new BadRequestException(
        `No active Price List row exists for ${category} / ${jobType} - add one before a Debit Note can be generated.`,
      );
    }
    if (priceRow.billingChannelId) {
      return {
        laborCost: Number(priceRow.billingChannelRate),
        billingChannelId: priceRow.billingChannelId,
        billingChannelName: priceRow.billingChannel?.name ?? null,
      };
    }
    return { laborCost: Number(priceRow.warrantyLaborCost), billingChannelId: null, billingChannelName: null };
  }

  async findById(id: string): Promise<DebitNote> {
    const debitNote = await this.debitNoteRepository.findOne({ where: { id } });
    if (!debitNote) {
      throw new NotFoundException(`Debit Note ${id} not found`);
    }
    return debitNote;
  }

  async findByJobCardId(jobCardId: string): Promise<DebitNote | null> {
    return this.debitNoteRepository.findOne({ where: { jobCardId } });
  }

  async findAll(): Promise<DebitNote[]> {
    return this.debitNoteRepository.find({ order: { createdAt: 'DESC' } });
  }

  /**
   * Lazily creates a DRAFT Debit Note the first time one's needed for a QC_PASSED,
   * interdepartment (B2B_SALES_CHANNEL + IN_WARRANTY) Job Card. Mirrors
   * InvoicingService.getOrCreateForJobCard exactly, including the same unique-index +
   * 23505 race-safety pattern.
   */
  async getOrCreateForJobCard(jobCardId: string): Promise<DebitNote> {
    const existing = await this.findByJobCardId(jobCardId);
    if (existing) {
      return existing;
    }

    const jobCard = await this.jobCardsService.findById(jobCardId);
    if (jobCard.status !== JobCardStatus.QC_PASSED && jobCard.status !== JobCardStatus.DELIVERED) {
      throw new BadRequestException(`Cannot generate a Debit Note for a Job Card that hasn't passed QC yet (current status: ${jobCard.status}).`);
    }
    if (jobCard.warrantyStatus !== WarrantyStatus.IN_WARRANTY) {
      throw new BadRequestException('Debit Notes are only for in-warranty interdepartment jobs - this Job Card is out-of-warranty (it should be invoiced instead).');
    }
    if (jobCard.appointment?.customerType !== CustomerType.B2B_SALES_CHANNEL) {
      throw new BadRequestException('Debit Notes are only for B2B_SALES_CHANNEL (interdepartment) appointments.');
    }

    const sparePartsCost = await this.computeSparePartsCost(jobCardId);
    const { laborCost, billingChannelId, billingChannelName } = await this.resolveLaborCost(jobCard.appointment);
    const totalAmount = Math.round((sparePartsCost + laborCost) * 100) / 100;

    try {
      const debitNote = this.debitNoteRepository.create({
        debitNoteNumber: await this.generateDebitNoteNumber(),
        jobCardId,
        sparePartsCost,
        laborCost,
        totalAmount,
        billingChannelId,
        billingChannelName,
        status: DebitNoteStatus.DRAFT,
      });
      return await this.debitNoteRepository.save(debitNote);
    } catch (err: any) {
      if (err?.code === '23505') {
        const winner = await this.findByJobCardId(jobCardId);
        if (winner) {
          return winner;
        }
      }
      throw err;
    }
  }

  /** Posts a DRAFT debit note - generates the GL journal entry. Idempotent-guarded: a
   * DRAFT can only be posted once (POSTED is terminal). */
  async post(id: string, postedByUserId: string): Promise<DebitNote> {
    const debitNote = await this.findById(id);
    if (debitNote.status === DebitNoteStatus.POSTED) {
      throw new BadRequestException('This Debit Note has already been posted.');
    }

    debitNote.status = DebitNoteStatus.POSTED;
    debitNote.postedAt = new Date();
    debitNote.postedByUserId = postedByUserId;
    const saved = await this.debitNoteRepository.save(debitNote);

    await this.glLedgerService.postDebitNote({
      debitNoteId: debitNote.id,
      debitNoteNumber: debitNote.debitNoteNumber,
      amount: debitNote.totalAmount,
    });

    return saved;
  }

  /** AC-16 recharge report: total interdepartment recharge amount, grouped by POSTED vs
   * DRAFT (posted = confirmed/recognized, draft = pending review). */
  async getRechargeReport(): Promise<{ posted: { count: number; total: number }; draft: { count: number; total: number } }> {
    const all = await this.findAll();
    const posted = all.filter((d) => d.status === DebitNoteStatus.POSTED);
    const draft = all.filter((d) => d.status === DebitNoteStatus.DRAFT);
    const sum = (list: DebitNote[]) => Math.round(list.reduce((s, d) => s + Number(d.totalAmount), 0) * 100) / 100;
    return {
      posted: { count: posted.length, total: sum(posted) },
      draft: { count: draft.length, total: sum(draft) },
    };
  }
}
