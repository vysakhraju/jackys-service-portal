import { Injectable, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { Delivery, DeliveryStatus } from './entities/delivery.entity';
// Cross-module entity-class import for typing/transaction use only (not a @Module import,
// so this does not create a Nest DI circular-module dependency) - the same established
// pattern InventoryService.consumeReservationsOnQcApproval() already uses for JobCard.
import { JobCard, JobCardStatus } from '../job-cards/entities/job-card.entity';
import { WarrantyStatus } from '../technician/entities/technician-visit.entity';
import { JobCardsService } from '../job-cards/job-cards.service';
import { InvoicingService } from '../invoicing/invoicing.service';
import { CreateDeliveryDto } from './dto/create-delivery.dto';
import { CapturePodDto } from './dto/capture-pod.dto';

interface DeliveryBlocker {
  jobCardId: string;
  jobCardNumber: string;
  invoiceId: string;
  invoiceStatus: string;
  amount: number;
}

@Injectable()
export class DeliveryService {
  constructor(
    @InjectRepository(Delivery)
    private deliveryRepository: Repository<Delivery>,
    @InjectDataSource()
    private dataSource: DataSource,
    private jobCardsService: JobCardsService,
    private invoicingService: InvoicingService,
  ) {}

  private async generateDeliveryNumber(manager: EntityManager): Promise<string> {
    const prefix = 'DLV-';
    const last = await manager
      .createQueryBuilder(Delivery, 'del')
      .where('del.deliveryNumber LIKE :prefix', { prefix: `${prefix}%` })
      .orderBy('del.deliveryNumber', 'DESC')
      .getOne();

    let sequence = 1;
    if (last) {
      sequence = parseInt(last.deliveryNumber.replace(prefix, ''), 10) + 1;
    }
    return `${prefix}${sequence.toString().padStart(4, '0')}`;
  }

  async findById(id: string): Promise<Delivery> {
    const delivery = await this.deliveryRepository.findOne({ where: { id } });
    if (!delivery) {
      throw new NotFoundException(`Delivery ${id} not found`);
    }
    return delivery;
  }

  /** List view - deliberately excludes the POD blob columns, see the entity's doc comment. */
  async findAll(status?: DeliveryStatus): Promise<Partial<Delivery>[]> {
    return this.deliveryRepository.find({
      where: status ? { status } : {},
      select: {
        id: true,
        deliveryNumber: true,
        status: true,
        dispatcherUserId: true,
        driverUserId: true,
        dispatchedAt: true,
        deliveredAt: true,
        podRecipientName: true,
        cancellationReason: true,
        createdAt: true,
        updatedAt: true,
      },
      order: { createdAt: 'DESC' },
    });
  }

  async findByJobCardId(jobCardId: string): Promise<Delivery | null> {
    const jobCard = await this.jobCardsService.findById(jobCardId);
    if (!jobCard.deliveryId) {
      return null;
    }
    return this.findById(jobCard.deliveryId);
  }

  /**
   * Frontend Phase 8: the Delivery detail screen needs its member Job Cards, and the only
   * existing primitive was job-card -> delivery (findByJobCardId above), not the reverse.
   * Thin read-only wrapper over the already-existing JobCardsService.findByDeliveryId,
   * which until now was only used internally by create()/capturePod()/cancel().
   */
  async findJobCards(id: string): Promise<JobCard[]> {
    await this.findById(id); // 404s if the delivery doesn't exist
    return this.jobCardsService.findByDeliveryId(id);
  }

  /**
   * The ready-for-delivery pool (GET /delivery/ready, IW/OOW tabs). Proactive
   * payment-status visibility for OOW jobs (the-fool finding: don't make a dispatcher
   * attempt a whole batch just to discover one job is unpaid) - a non-creating lookup
   * only, so simply listing the pool never side-effects an invoice into existence. That
   * stays reserved for an actual delivery-creation attempt (create() below), and for
   * GET /invoicing/job-card/:id, which is explicitly its own lazy-create-on-read endpoint.
   */
  async findReady(warrantyStatus?: WarrantyStatus): Promise<Array<{ jobCard: JobCard; invoiceStatus: string | null; payable: boolean }>> {
    const jobCards = await this.jobCardsService.findReadyForDelivery(warrantyStatus);

    return Promise.all(
      jobCards.map(async (jobCard) => {
        if (jobCard.warrantyStatus !== WarrantyStatus.OUT_OF_WARRANTY) {
          return { jobCard, invoiceStatus: null, payable: true };
        }
        const invoice = await this.invoicingService.findByJobCardId(jobCard.id);
        return {
          jobCard,
          invoiceStatus: invoice?.status ?? null,
          payable: invoice?.status === 'PAID',
        };
      }),
    );
  }

  /**
   * FR-11/AC-10: creates one Delivery (batch or normal) covering every listed Job Card.
   *
   * Locking order (the-fool fix - two dispatchers concurrently batching overlapping Job
   * Cards into different DLV#s): a global "delivery number sequence" advisory lock first
   * (always acquired first, by every call, so it can never be the cause of a deadlock
   * against the per-job-card locks below), then a per-job-card advisory lock for every
   * member, sorted by id so two batches sharing members in reverse order can't deadlock
   * against each other either. Whichever call gets there first wins the claim; the loser
   * sees `deliveryId` already set on the shared job card and gets a clean 409, never a
   * silent double-claim.
   *
   * FR-12/AC-11: blocks the WHOLE batch (not a partial success) if any out-of-warranty
   * member isn't paid (or B2B Credit) yet - mirrors Phase 6's negative-inventory-gate
   * response shape (409 + a `blockers` array). Lazily creates the DRAFT invoice via
   * InvoicingService purely so the blocker can state the real amount owed.
   */
  async create(dto: CreateDeliveryDto, dispatcherUserId: string): Promise<{ delivery: Delivery; jobCards: JobCard[] }> {
    const sortedIds = Array.from(new Set(dto.jobCardIds)).sort();

    const deliveryId = await this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['delivery:number-sequence']);

      for (const id of sortedIds) {
        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`jobcard:${id}`]);
      }

      const jobCards: JobCard[] = [];
      for (const id of sortedIds) {
        const jobCard = await manager.findOne(JobCard, { where: { id } });
        if (!jobCard) {
          throw new NotFoundException(`Job Card ${id} not found`);
        }
        if (jobCard.status !== JobCardStatus.QC_PASSED) {
          throw new BadRequestException(`Job Card ${jobCard.jobCardNumber} is ${jobCard.status}, not QC_PASSED - cannot be added to a delivery.`);
        }
        if (jobCard.deliveryId) {
          throw new ConflictException(`Job Card ${jobCard.jobCardNumber} is already attached to another delivery (${jobCard.deliveryId}).`);
        }
        jobCards.push(jobCard);
      }

      const blockers: DeliveryBlocker[] = [];
      for (const jobCard of jobCards) {
        if (jobCard.warrantyStatus === WarrantyStatus.OUT_OF_WARRANTY) {
          const { payable, invoice } = await this.invoicingService.isPayableForDelivery(jobCard.id);
          if (!payable) {
            blockers.push({ jobCardId: jobCard.id, jobCardNumber: jobCard.jobCardNumber, invoiceId: invoice.id, invoiceStatus: invoice.status, amount: Number(invoice.amount) });
          }
        }
      }
      if (blockers.length > 0) {
        throw new ConflictException({
          message: 'Cannot create delivery: one or more out-of-warranty Job Cards are unpaid (FR-12/AC-11). Record payment (Cash/Card/Bank Transfer/B2B Credit) first.',
          blockers,
        });
      }

      const delivery = manager.create(Delivery, {
        deliveryNumber: await this.generateDeliveryNumber(manager),
        status: DeliveryStatus.PENDING,
        dispatcherUserId,
      });
      const saved = await manager.save(delivery);

      for (const jobCard of jobCards) {
        jobCard.deliveryId = saved.id;
        await manager.save(jobCard);
      }

      return saved.id;
    });

    const delivery = await this.findById(deliveryId);
    const jobCards = await this.jobCardsService.findByDeliveryId(deliveryId);
    return { delivery, jobCards };
  }

  async dispatch(id: string, driverUserId?: string): Promise<Delivery> {
    const delivery = await this.findById(id);

    if (delivery.status !== DeliveryStatus.PENDING) {
      throw new BadRequestException(`Cannot dispatch: delivery is ${delivery.status}, not PENDING.`);
    }

    delivery.status = DeliveryStatus.DISPATCHED;
    delivery.dispatchedAt = new Date();
    if (driverUserId) {
      delivery.driverUserId = driverUserId;
    }
    return this.deliveryRepository.save(delivery);
  }

  /**
   * AC-12: POD mandatory (signature OR photo) - checked here since "at least one of two
   * optional fields" isn't a natural per-property class-validator rule. Also re-checks
   * the OOW-paid gate defensively, right before the irreversible DELIVERED flip - same
   * "re-check at the irreversible action" pattern Phase 6's qc/approve uses for stock.
   * Payment status could in principle change between delivery-creation and hand-back
   * (e.g. an invoice disputed/reverted in the meantime); handing back an unpaid
   * out-of-warranty unit is the one mistake this whole phase exists to prevent.
   */
  async capturePod(id: string, dto: CapturePodDto): Promise<Delivery> {
    if (!dto.signatureBase64 && !dto.photoBase64) {
      throw new BadRequestException('POD requires at least a signature or a photo (AC-12).');
    }

    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`delivery:${id}`]);

      const delivery = await manager.findOne(Delivery, { where: { id } });
      if (!delivery) {
        throw new NotFoundException(`Delivery ${id} not found`);
      }
      if (delivery.status !== DeliveryStatus.DISPATCHED) {
        throw new BadRequestException(`Cannot capture POD: delivery is ${delivery.status}, not DISPATCHED.`);
      }

      const jobCards = await manager.find(JobCard, { where: { deliveryId: id } });

      const blockers: DeliveryBlocker[] = [];
      for (const jobCard of jobCards) {
        if (jobCard.warrantyStatus === WarrantyStatus.OUT_OF_WARRANTY) {
          const { payable, invoice } = await this.invoicingService.isPayableForDelivery(jobCard.id);
          if (!payable) {
            blockers.push({ jobCardId: jobCard.id, jobCardNumber: jobCard.jobCardNumber, invoiceId: invoice.id, invoiceStatus: invoice.status, amount: Number(invoice.amount) });
          }
        }
      }
      if (blockers.length > 0) {
        throw new ConflictException({
          message: 'Cannot capture POD: one or more out-of-warranty Job Cards on this delivery are no longer paid. Resolve payment before handing back the unit.',
          blockers,
        });
      }

      delivery.podSignatureBase64 = dto.signatureBase64 ?? null;
      delivery.podPhotoBase64 = dto.photoBase64 ?? null;
      delivery.podRecipientName = dto.recipientName;
      delivery.podNotes = dto.notes ?? null;
      delivery.deliveredAt = new Date();
      delivery.status = DeliveryStatus.DELIVERED;
      await manager.save(delivery);

      for (const jobCard of jobCards) {
        jobCard.status = JobCardStatus.DELIVERED;
        await manager.save(jobCard);
      }

      return delivery;
    });
  }

  /** Only while PENDING (before dispatch) - releases every member back to the ready-for-delivery pool. */
  async cancel(id: string, reason: string): Promise<Delivery> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`delivery:${id}`]);

      const delivery = await manager.findOne(Delivery, { where: { id } });
      if (!delivery) {
        throw new NotFoundException(`Delivery ${id} not found`);
      }
      if (delivery.status !== DeliveryStatus.PENDING) {
        throw new BadRequestException(`Cannot cancel: delivery is ${delivery.status} - only a PENDING (not yet dispatched) delivery can be cancelled.`);
      }

      const jobCards = await manager.find(JobCard, { where: { deliveryId: id } });
      for (const jobCard of jobCards) {
        jobCard.deliveryId = null;
        await manager.save(jobCard);
      }

      delivery.status = DeliveryStatus.CANCELLED;
      delivery.cancellationReason = reason;
      return manager.save(delivery);
    });
  }
}
