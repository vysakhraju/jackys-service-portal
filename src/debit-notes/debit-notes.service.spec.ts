import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DebitNotesService } from './debit-notes.service';
import { DebitNoteStatus } from './entities/debit-note.entity';
import { ReservationStatus } from '../inventory/entities/inventory-reservation.entity';
import { JobCardStatus } from '../job-cards/entities/job-card.entity';
import { WarrantyStatus } from '../technician/entities/technician-visit.entity';
import { CustomerType, JobType } from '../appointments/entities/appointment.entity';

describe('DebitNotesService', () => {
  let service: DebitNotesService;
  let debitNoteRepository: any;
  let reservationRepository: any;
  let sparePartRepository: any;
  let priceListRepository: any;
  let jobCardsService: any;
  let glLedgerService: any;
  let queryBuilder: any;

  const debitNote = (overrides: any = {}) =>
    ({
      id: 'dn-1',
      debitNoteNumber: 'DN-0001',
      jobCardId: 'jc-1',
      sparePartsCost: 100,
      laborCost: 50,
      totalAmount: 150,
      status: DebitNoteStatus.DRAFT,
      postedAt: null,
      postedByUserId: null,
      ...overrides,
    } as any);

  const interdeptJobCard = (overrides: any = {}) =>
    ({
      id: 'jc-1',
      status: JobCardStatus.QC_PASSED,
      warrantyStatus: WarrantyStatus.IN_WARRANTY,
      appointment: {
        customerType: CustomerType.B2B_SALES_CHANNEL,
        jobType: JobType.REPAIR,
        applianceModel: { category: 'REFRIGERATOR' },
      },
      ...overrides,
    } as any);

  beforeEach(() => {
    queryBuilder = {
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
    };
    debitNoteRepository = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((data: any) => data),
      save: jest.fn((data: any) => Promise.resolve({ ...data, id: data.id || 'dn-1' })),
      createQueryBuilder: jest.fn(() => queryBuilder),
    };
    reservationRepository = {
      find: jest.fn().mockResolvedValue([]),
    };
    sparePartRepository = {
      findOne: jest.fn(),
    };
    priceListRepository = {
      findOne: jest.fn(),
    };
    jobCardsService = {
      findById: jest.fn(),
    };
    glLedgerService = {
      postDebitNote: jest.fn().mockResolvedValue({}),
    };

    service = new DebitNotesService(
      debitNoteRepository,
      reservationRepository,
      sparePartRepository,
      priceListRepository,
      jobCardsService,
      glLedgerService,
    );
  });

  describe('getOrCreateForJobCard', () => {
    it('returns the existing Debit Note without recomputing costs', async () => {
      debitNoteRepository.findOne.mockResolvedValue(debitNote());

      const result = await service.getOrCreateForJobCard('jc-1');

      expect(result.id).toBe('dn-1');
      expect(reservationRepository.find).not.toHaveBeenCalled();
    });

    it('rejects a Job Card that has not passed QC yet', async () => {
      debitNoteRepository.findOne.mockResolvedValue(null);
      jobCardsService.findById.mockResolvedValue(interdeptJobCard({ status: JobCardStatus.IN_PROGRESS }));

      await expect(service.getOrCreateForJobCard('jc-1')).rejects.toThrow(BadRequestException);
    });

    it('rejects an out-of-warranty Job Card (should be invoiced instead)', async () => {
      debitNoteRepository.findOne.mockResolvedValue(null);
      jobCardsService.findById.mockResolvedValue(interdeptJobCard({ warrantyStatus: WarrantyStatus.OUT_OF_WARRANTY }));

      await expect(service.getOrCreateForJobCard('jc-1')).rejects.toThrow(BadRequestException);
    });

    it('rejects a non-B2B_SALES_CHANNEL appointment', async () => {
      debitNoteRepository.findOne.mockResolvedValue(null);
      jobCardsService.findById.mockResolvedValue(interdeptJobCard({ appointment: { customerType: CustomerType.B2B, modelNumber: 'MODEL-X' } }));

      await expect(service.getOrCreateForJobCard('jc-1')).rejects.toThrow(BadRequestException);
    });

    it('sums unitCost * quantityReserved across CONSUMED reservations for spare parts cost', async () => {
      debitNoteRepository.findOne.mockResolvedValue(null);
      jobCardsService.findById.mockResolvedValue(interdeptJobCard());
      reservationRepository.find.mockResolvedValue([
        { sparePartId: 'sp-1', quantityReserved: 2, status: ReservationStatus.CONSUMED },
        { sparePartId: 'sp-2', quantityReserved: 1, status: ReservationStatus.CONSUMED },
      ]);
      sparePartRepository.findOne
        .mockResolvedValueOnce({ id: 'sp-1', unitCost: 30 })
        .mockResolvedValueOnce({ id: 'sp-2', unitCost: 40 });
      priceListRepository.findOne.mockResolvedValue({ warrantyLaborCost: 50, billingChannelId: null });

      const result = await service.getOrCreateForJobCard('jc-1');

      // 2*30 + 1*40 = 100 spare parts cost, + 50 labor = 150
      expect(result.sparePartsCost).toBe(100);
      expect(result.laborCost).toBe(50);
      expect(result.totalAmount).toBe(150);
      expect(result.billingChannelId).toBeNull();
      expect(priceListRepository.findOne).toHaveBeenCalledWith({
        where: { category: 'REFRIGERATOR', jobType: JobType.REPAIR, isActive: true },
        relations: { billingChannel: true },
      });
    });

    // Phase 4 (billing logic + Billing Channel routing, 2026-09-22): when the matched
    // Price List row has a Billing Channel configured, its billingChannelRate overrides
    // the plain warrantyLaborCost, and the Debit Note records which channel applied.
    it('uses billingChannelRate instead of warrantyLaborCost, and stamps the channel, when the matched Price List row has a Billing Channel set', async () => {
      debitNoteRepository.findOne.mockResolvedValue(null);
      jobCardsService.findById.mockResolvedValue(interdeptJobCard());
      reservationRepository.find.mockResolvedValue([]);
      priceListRepository.findOne.mockResolvedValue({
        warrantyLaborCost: 50,
        billingChannelId: 'bc-1',
        billingChannelRate: 80,
        billingChannel: { id: 'bc-1', name: 'Acme Partner' },
      });

      const result = await service.getOrCreateForJobCard('jc-1');

      expect(result.laborCost).toBe(80);
      expect(result.totalAmount).toBe(80);
      expect(result.billingChannelId).toBe('bc-1');
      expect(result.billingChannelName).toBe('Acme Partner');
    });

    // 2026-09-25 revision (JER-C AED 0.00 dead-end fix) - BillingChannel.defaultRate is
    // retired as a pricing input. An appointment's picked Billing Channel now only
    // SELECTS the channel; the Price List row's own billingChannelRate is the only rate
    // source, matched against the appointment's billingChannelId (not a flat channel rate).
    it("uses the Price List row's billingChannelRate when the appointment picks the SAME channel the row is configured for", async () => {
      debitNoteRepository.findOne.mockResolvedValue(null);
      jobCardsService.findById.mockResolvedValue(
        interdeptJobCard({
          appointment: {
            customerType: CustomerType.B2B_SALES_CHANNEL,
            jobType: JobType.REPAIR,
            applianceModel: { category: 'REFRIGERATOR' },
            billingChannelId: 'bc-row',
            billingChannel: { id: 'bc-row', name: 'Row Channel' },
          },
        }),
      );
      reservationRepository.find.mockResolvedValue([]);
      priceListRepository.findOne.mockResolvedValue({
        warrantyLaborCost: 50,
        billingChannelId: 'bc-row',
        billingChannelRate: 80,
        billingChannel: { id: 'bc-row', name: 'Row Channel' },
      });

      const result = await service.getOrCreateForJobCard('jc-1');

      expect(result.laborCost).toBe(80);
      expect(result.billingChannelId).toBe('bc-row');
      expect(result.billingChannelName).toBe('Row Channel');
    });

    it("throws when the appointment picks a Billing Channel the matched Price List row has no rate for, rather than silently charging 0 labor or the wrong channel's rate", async () => {
      debitNoteRepository.findOne.mockResolvedValue(null);
      jobCardsService.findById.mockResolvedValue(
        interdeptJobCard({
          appointment: {
            customerType: CustomerType.B2B_SALES_CHANNEL,
            jobType: JobType.REPAIR,
            applianceModel: { category: 'REFRIGERATOR' },
            billingChannelId: 'bc-appt',
            billingChannel: { id: 'bc-appt', name: 'No Rate Channel' },
          },
        }),
      );
      reservationRepository.find.mockResolvedValue([]);
      priceListRepository.findOne.mockResolvedValue({ warrantyLaborCost: 50, billingChannelId: null });

      await expect(service.getOrCreateForJobCard('jc-1')).rejects.toThrow(BadRequestException);
    });

    it('throws when the appointment has no Appliance Model / Category linked, rather than silently charging 0 labor', async () => {
      debitNoteRepository.findOne.mockResolvedValue(null);
      jobCardsService.findById.mockResolvedValue(
        interdeptJobCard({ appointment: { customerType: CustomerType.B2B_SALES_CHANNEL, jobType: JobType.REPAIR, applianceModel: null } }),
      );
      reservationRepository.find.mockResolvedValue([]);

      await expect(service.getOrCreateForJobCard('jc-1')).rejects.toThrow(BadRequestException);
      expect(priceListRepository.findOne).not.toHaveBeenCalled();
    });

    it('throws rather than silently charging 0 labor when no matching Price List row exists at all', async () => {
      debitNoteRepository.findOne.mockResolvedValue(null);
      jobCardsService.findById.mockResolvedValue(interdeptJobCard());
      reservationRepository.find.mockResolvedValue([]);
      priceListRepository.findOne.mockResolvedValue(null);

      await expect(service.getOrCreateForJobCard('jc-1')).rejects.toThrow(BadRequestException);
    });

    it('generates a DN-#### number, incrementing off the highest existing one', async () => {
      debitNoteRepository.findOne.mockResolvedValue(null);
      jobCardsService.findById.mockResolvedValue(interdeptJobCard());
      reservationRepository.find.mockResolvedValue([]);
      priceListRepository.findOne.mockResolvedValue({ warrantyLaborCost: 50 });
      queryBuilder.getOne.mockResolvedValue(debitNote({ debitNoteNumber: 'DN-0004' }));

      const result = await service.getOrCreateForJobCard('jc-1');

      expect(result.debitNoteNumber).toBe('DN-0005');
    });

    it('race safety: a unique-constraint violation on save refetches the winner', async () => {
      debitNoteRepository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(debitNote({ id: 'dn-winner' }));
      jobCardsService.findById.mockResolvedValue(interdeptJobCard());
      reservationRepository.find.mockResolvedValue([]);
      priceListRepository.findOne.mockResolvedValue({ warrantyLaborCost: 50 });
      debitNoteRepository.save.mockRejectedValueOnce({ code: '23505' });

      const result = await service.getOrCreateForJobCard('jc-1');

      expect(result.id).toBe('dn-winner');
    });
  });

  describe('post', () => {
    it('posts a DRAFT Debit Note and generates its GL entry', async () => {
      debitNoteRepository.findOne.mockResolvedValue(debitNote());

      const result = await service.post('dn-1', 'user-1');

      expect(result.status).toBe(DebitNoteStatus.POSTED);
      expect(result.postedByUserId).toBe('user-1');
      expect(result.postedAt).toBeInstanceOf(Date);
      expect(glLedgerService.postDebitNote).toHaveBeenCalledWith(
        expect.objectContaining({ debitNoteId: 'dn-1', amount: 150 }),
      );
    });

    it('rejects posting an already-POSTED Debit Note', async () => {
      debitNoteRepository.findOne.mockResolvedValue(debitNote({ status: DebitNoteStatus.POSTED }));

      await expect(service.post('dn-1', 'user-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('findById', () => {
    it('throws NotFoundException when missing', async () => {
      debitNoteRepository.findOne.mockResolvedValue(null);

      await expect(service.findById('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getRechargeReport', () => {
    it('splits totals between posted and draft Debit Notes', async () => {
      debitNoteRepository.find.mockResolvedValue([
        debitNote({ id: 'dn-1', status: DebitNoteStatus.POSTED, totalAmount: 150 }),
        debitNote({ id: 'dn-2', status: DebitNoteStatus.POSTED, totalAmount: 200 }),
        debitNote({ id: 'dn-3', status: DebitNoteStatus.DRAFT, totalAmount: 75 }),
      ]);

      const result = await service.getRechargeReport();

      expect(result.posted).toEqual({ count: 2, total: 350 });
      expect(result.draft).toEqual({ count: 1, total: 75 });
    });
  });
});
