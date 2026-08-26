import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { DebitNote, DebitNoteStatus } from './entities/debit-note.entity';
import { InventoryReservation, ReservationStatus } from '../inventory/entities/inventory-reservation.entity';
import { SparePart } from '../master-data/entities/spare-part.entity';
import { ServicePriceList, ServiceActivityType } from '../master-data/entities/service-price-list.entity';
import { JobCardsService } from '../job-cards/job-cards.service';
import { JobCardStatus } from '../job-cards/entities/job-card.entity';
import { WarrantyStatus } from '../technician/entities/technician-visit.entity';
import { CustomerType } from '../appointments/entities/appointment.entity';
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
   * ASSUMPTION (documented, since no direct Job-Card-to-ServicePriceList link exists
   * yet): the interdepartment labor rate is looked up from ServicePriceList rows with
   * activityType=REPAIR (a workshop/on-site repair job is a REPAIR activity in this
   * schema's terms) - first trying a row matching the Job Card's model, falling back to
   * a model-agnostic (modelId IS NULL) default REPAIR row. If neither exists, this
   * throws rather than silently charging 0 labor - a silent 0 would understate every
   * interdepartment recharge and is exactly the kind of gap a real Finance audit would
   * flag, so it's a hard stop here instead.
   */
  private async resolveLaborCost(modelNumber: string | null): Promise<number> {
    if (modelNumber) {
      const specific = await this.priceListRepository.findOne({
        where: { activityType: ServiceActivityType.REPAIR, modelId: modelNumber, isActive: true },
      });
      if (specific) {
        return Number(specific.interdepartmentLaborCost);
      }
    }
    const fallback = await this.priceListRepository.findOne({
      where: { activityType: ServiceActivityType.REPAIR, modelId: IsNull(), isActive: true },
    });
    if (fallback) {
      return Number(fallback.interdepartmentLaborCost);
    }
    throw new BadRequestException(
      'No active REPAIR Service Price List entry (model-specific or default) exists to determine the interdepartment labor rate - add one before a Debit Note can be generated.',
    );
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
    const laborCost = await this.resolveLaborCost(jobCard.appointment?.modelNumber ?? null);
    const totalAmount = Math.round((sparePartsCost + laborCost) * 100) / 100;

    try {
      const debitNote = this.debitNoteRepository.create({
        debitNoteNumber: await this.generateDebitNoteNumber(),
        jobCardId,
        sparePartsCost,
        laborCost,
        totalAmount,
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
