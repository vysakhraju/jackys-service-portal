import { Injectable, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager, In } from 'typeorm';
import { Delivery, DeliveryStatus } from './entities/delivery.entity';
// Cross-module entity-class import for typing/transaction use only (not a @Module import,
// so this does not create a Nest DI circular-module dependency) - the same established
// pattern InventoryService.consumeReservationsOnQcApproval() already uses for JobCard.
import { JobCard, JobCardStatus } from '../job-cards/entities/job-card.entity';
import { WarrantyStatus } from '../technician/entities/technician-visit.entity';
import { User, UserStatus } from '../auth/entities/user.entity';
import { RoleName } from '../auth/entities/role.entity';
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
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectDataSource()
    private dataSource: DataSource,
    private jobCardsService: JobCardsService,
    private invoicingService: InvoicingService,
  ) {}

  /**
   * #218 (2026-09-10): backs the Dispatch delivery picker with real names instead of a
   * pasted UUID. GET /users is SUPER_ADMIN/SERVICE_HEAD-only, unusable by whoever actually
   * dispatches (DELIVERY_MANAGE = LOGISTICS_DISPATCHER/DRIVER) - this is a narrow,
   * purpose-built list gated the same as the dispatch action itself, not a general user
   * directory.
   */
  async listActiveDrivers(): Promise<{ id: string; name: string }[]> {
    const drivers = await this.userRepository.find({
      where: { role: { name: RoleName.DRIVER }, status: UserStatus.ACTIVE },
      relations: { role: true },
      order: { firstName: 'ASC', lastName: 'ASC' },
    });
    return drivers.map((d) => ({ id: d.id, name: d.fullName }));
  }

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

  /**
   * List view - deliberately excludes the POD blob columns, see the entity's doc comment.
   *
   * Modification Request (2026-09-15, Delivery & Invoicing screen): added dateFrom/dateTo
   * (on delivery.createdAt, date-only, dateTo inclusive of that whole day) and a free-text
   * search across the DLV#, member job card #s, and customer name/phone. Also now resolves
   * driverUserId -> a real name (same reasoning as listActiveDrivers's own doc comment:
   * don't make the frontend show a raw UUID) and attaches each delivery's member job cards
   * (id/jobCardNumber) plus a customerType summary, so the list can show "Job card" and
   * "Customer type" columns without a second request per row. Returns plain objects, not
   * raw entities - same "compute the derived field into a plain field, don't rely on
   * default JSON serialization of a relation/getter" discipline as listActiveDrivers.
   */
  async findAll(status?: DeliveryStatus, dateFrom?: string, dateTo?: string, search?: string): Promise<Record<string, unknown>[]> {
    const qb = this.deliveryRepository
      .createQueryBuilder('del')
      .select([
        'del.id',
        'del.deliveryNumber',
        'del.status',
        'del.dispatcherUserId',
        'del.driverUserId',
        'del.dispatchedAt',
        'del.deliveredAt',
        'del.podRecipientName',
        'del.cancellationReason',
        'del.createdAt',
        'del.updatedAt',
      ]);

    if (status) {
      qb.andWhere('del.status = :status', { status });
    }
    if (dateFrom) {
      qb.andWhere('del.createdAt >= :dateFrom', { dateFrom: `${dateFrom} 00:00:00` });
    }
    if (dateTo) {
      qb.andWhere('del.createdAt <= :dateTo', { dateTo: `${dateTo} 23:59:59.999` });
    }

    const trimmed = search?.trim();
    if (trimmed) {
      const escaped = trimmed.replace(/[\\%_]/g, (c) => `\\${c}`);
      const like = `%${escaped}%`;
      // Job-card/customer fields live on a related table, not this one - a subquery keeps
      // this a plain filter on `del` instead of pulling in a join that would duplicate rows
      // (one delivery can have many member job cards).
      qb.andWhere(
        `(del.deliveryNumber ILIKE :like ESCAPE '\\' OR del.id IN (
          SELECT jc."deliveryId" FROM job_cards jc
          INNER JOIN appointments apt ON apt.id = jc."appointmentId"
          WHERE jc."deliveryId" IS NOT NULL
            AND (jc."jobCardNumber" ILIKE :like ESCAPE '\\' OR apt."customerName" ILIKE :like ESCAPE '\\' OR apt."customerPhone" ILIKE :like ESCAPE '\\')
        ))`,
        { like },
      );
    }

    const deliveries = await qb.orderBy('del.createdAt', 'DESC').getMany();
    if (deliveries.length === 0) return [];

    const driverIds = [...new Set(deliveries.map((d) => d.driverUserId).filter((id): id is string => !!id))];
    const drivers = driverIds.length
      ? await this.userRepository.find({ where: { id: In(driverIds) } })
      : [];
    const driverNameById = new Map(drivers.map((u) => [u.id, u.fullName]));

    const jobCards = await this.jobCardsService.findByDeliveryIds(deliveries.map((d) => d.id));
    const jobCardsByDeliveryId = new Map<string, { id: string; jobCardNumber: string; customerType: string | null }[]>();
    for (const jc of jobCards) {
      const list = jobCardsByDeliveryId.get(jc.deliveryId!) ?? [];
      list.push({ id: jc.id, jobCardNumber: jc.jobCardNumber, customerType: jc.appointment?.customerType ?? null });
      jobCardsByDeliveryId.set(jc.deliveryId!, list);
    }

    return deliveries.map((d) => {
      const members = jobCardsByDeliveryId.get(d.id) ?? [];
      const distinctCustomerTypes = [...new Set(members.map((m) => m.customerType).filter((t): t is string => !!t))];
      return {
        id: d.id,
        deliveryNumber: d.deliveryNumber,
        status: d.status,
        dispatcherUserId: d.dispatcherUserId,
        driverUserId: d.driverUserId,
        driverName: d.driverUserId ? (driverNameById.get(d.driverUserId) ?? null) : null,
        dispatchedAt: d.dispatchedAt,
        deliveredAt: d.deliveredAt,
        podRecipientName: d.podRecipientName,
        cancellationReason: d.cancellationReason,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        jobCards: members.map((m) => ({ id: m.id, jobCardNumber: m.jobCardNumber })),
        customerType: distinctCustomerTypes.length === 1 ? distinctCustomerTypes[0] : distinctCustomerTypes.length > 1 ? 'MIXED' : null,
      };
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
  async findReady(
    warrantyStatus?: WarrantyStatus,
    dateFrom?: string,
    dateTo?: string,
    search?: string,
  ): Promise<Array<{ jobCard: JobCard; invoiceStatus: string | null; payable: boolean }>> {
    const jobCards = await this.jobCardsService.findReadyForDelivery(warrantyStatus, dateFrom, dateTo, search);

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

    if (driverUserId) {
      // #218 (2026-09-10): this endpoint accepted any user id with zero role validation
      // until now - found while building the driver-name picker above. Mirrors
      // AppointmentsService.assignTechnician()'s own role-check pattern.
      const driver = await this.userRepository.findOne({ where: { id: driverUserId }, relations: { role: true } });
      if (!driver || driver.role.name !== RoleName.DRIVER) {
        throw new BadRequestException('driverUserId must belong to a user with the Driver role.');
      }
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
