import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DebitNotesService } from './debit-notes.service';
import { DebitNoteStatus } from './entities/debit-note.entity';
import { ReservationStatus } from '../inventory/entities/inventory-reservation.entity';
import { ServiceActivityType } from '../master-data/entities/service-price-list.entity';
import { JobCardStatus } from '../job-cards/entities/job-card.entity';
import { WarrantyStatus } from '../technician/entities/technician-visit.entity';
import { CustomerType } from '../appointments/entities/appointment.entity';

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
      appointment: { customerType: CustomerType.B2B_SALES_CHANNEL, modelNumber: 'MODEL-X' },
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
      priceListRepository.findOne.mockResolvedValue({ interdepartmentLaborCost: 50 });

      const result = await service.getOrCreateForJobCard('jc-1');

      // 2*30 + 1*40 = 100 spare parts cost, + 50 labor = 150
      expect(result.sparePartsCost).toBe(100);
      expect(result.laborCost).toBe(50);
      expect(result.totalAmount).toBe(150);
    });

    it('falls back to the model-agnostic REPAIR price list row when no model-specific one exists', async () => {
      debitNoteRepository.findOne.mockResolvedValue(null);
      jobCardsService.findById.mockResolvedValue(interdeptJobCard());
      reservationRepository.find.mockResolvedValue([]);
      priceListRepository.findOne
        .mockResolvedValueOnce(null) // model-specific lookup
        .mockResolvedValueOnce({ interdepartmentLaborCost: 75 }); // fallback lookup

      const result = await service.getOrCreateForJobCard('jc-1');

      expect(result.laborCost).toBe(75);
    });

    it('throws rather than silently charging 0 labor when no REPAIR price list row exists at all', async () => {
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
      priceListRepository.findOne.mockResolvedValue({ interdepartmentLaborCost: 50 });
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
      priceListRepository.findOne.mockResolvedValue({ interdepartmentLaborCost: 50 });
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
