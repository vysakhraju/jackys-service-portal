import { BadRequestException, NotFoundException } from '@nestjs/common';
import { WarrantyClaimsService } from './warranty-claims.service';
import { WarrantyClaim, WarrantyClaimStatus } from './entities/warranty-claim.entity';
import { ReservationStatus } from '../inventory/entities/inventory-reservation.entity';
import { WarrantyStatus } from '../technician/entities/technician-visit.entity';

describe('WarrantyClaimsService', () => {
  let service: WarrantyClaimsService;
  let warrantyClaimRepository: any;
  let warrantyClaimLineRepository: any;
  let dataSource: any;
  let glLedgerService: any;
  let claimNumberQueryBuilder: any;
  let manager: any;
  let alreadyClaimedQb: any;
  let candidatesQb: any;

  const claim = (overrides: any = {}) =>
    ({
      id: 'claim-1',
      claimNumber: 'WC-0001',
      supplier: 'Samsung Gulf FZE',
      periodStart: new Date('2026-08-01'),
      periodEnd: new Date('2026-08-31'),
      status: WarrantyClaimStatus.DRAFT,
      totalClaimedAmount: 200,
      generatedByUserId: 'clerk-1',
      claimReferenceNumber: null,
      submittedByUserId: null,
      submittedAt: null,
      creditNoteNumber: null,
      creditNoteAmount: null,
      creditReceivedByUserId: null,
      creditReceivedAt: null,
      notes: null,
      cancellationReason: null,
      lines: [],
      ...overrides,
    } as any);

  const reservationCandidate = (overrides: any = {}) =>
    ({
      id: 'res-1',
      jobCardId: 'jc-1',
      jobCard: { jobCardNumber: 'JC-0001', serialNumber: 'SN-0001' },
      sparePart: { code: 'SP-1', name: 'Compressor Unit', unitCost: 100 },
      quantityReserved: 2,
      consumedAt: new Date('2026-08-15'),
      ...overrides,
    } as any);

  const makeChainableQb = (terminal: 'getMany' | 'getRawMany' | 'getOne') => {
    const qb: any = {};
    qb.select = jest.fn(() => qb);
    qb.innerJoinAndSelect = jest.fn(() => qb);
    qb.where = jest.fn(() => qb);
    qb.andWhere = jest.fn(() => qb);
    qb.orderBy = jest.fn(() => qb);
    qb.getMany = jest.fn().mockResolvedValue([]);
    qb.getRawMany = jest.fn().mockResolvedValue([]);
    qb.getOne = jest.fn().mockResolvedValue(null);
    void terminal;
    return qb;
  };

  beforeEach(() => {
    claimNumberQueryBuilder = {
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
    };

    warrantyClaimRepository = {
      createQueryBuilder: jest.fn(() => claimNumberQueryBuilder),
      findOne: jest.fn().mockResolvedValue(claim()),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn((data) => Promise.resolve(data)),
    };

    warrantyClaimLineRepository = {
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    alreadyClaimedQb = makeChainableQb('getRawMany');
    candidatesQb = makeChainableQb('getMany');

    manager = {
      query: jest.fn().mockResolvedValue(undefined),
      createQueryBuilder: jest
        .fn()
        .mockImplementationOnce(() => alreadyClaimedQb)
        .mockImplementationOnce(() => candidatesQb),
      create: jest.fn((_entity, data) => data),
      save: jest.fn((data) => Promise.resolve(data)),
      // aggregate()'s final step re-fetches through `manager` (not the injected
      // Repository - see the regression this guards, in the service's own comment) to
      // stay on the same transactional connection. A safe non-null default is enough for
      // tests that only care about what was passed to manager.save/create along the way.
      findOne: jest.fn().mockResolvedValue(claim()),
    };

    dataSource = {
      transaction: jest.fn((cb) => cb(manager)),
    };

    glLedgerService = {
      postWarrantyCreditNote: jest.fn().mockResolvedValue({ id: 'gl-1' }),
    };

    service = new WarrantyClaimsService(warrantyClaimRepository, warrantyClaimLineRepository, dataSource, glLedgerService);
  });

  describe('aggregate', () => {
    it('throws BadRequestException if periodStart is after periodEnd', async () => {
      await expect(
        service.aggregate({ supplier: 'Samsung Gulf FZE', periodStart: '2026-08-31', periodEnd: '2026-08-01' } as any, 'clerk-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when nothing unclaimed is found for the vendor/period', async () => {
      candidatesQb.getMany.mockResolvedValue([]);
      await expect(
        service.aggregate({ supplier: 'Samsung Gulf FZE', periodStart: '2026-08-01', periodEnd: '2026-08-31' } as any, 'clerk-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('takes a per-supplier Postgres advisory lock inside the transaction (the-fool finding #1)', async () => {
      candidatesQb.getMany.mockResolvedValue([reservationCandidate()]);
      await service.aggregate({ supplier: 'Samsung Gulf FZE', periodStart: '2026-08-01', periodEnd: '2026-08-31' } as any, 'clerk-1');

      expect(manager.query).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(hashtext($1))', ['warranty-claim-aggregate:Samsung Gulf FZE']);
    });

    it('excludes reservations already referenced by a WarrantyClaimLine from the candidate pool', async () => {
      alreadyClaimedQb.getRawMany.mockResolvedValue([{ id: 'res-already-claimed' }]);
      candidatesQb.getMany.mockResolvedValue([reservationCandidate()]);

      await service.aggregate({ supplier: 'Samsung Gulf FZE', periodStart: '2026-08-01', periodEnd: '2026-08-31' } as any, 'clerk-1');

      expect(candidatesQb.andWhere).toHaveBeenCalledWith('r.id NOT IN (:...claimed)', { claimed: ['res-already-claimed'] });
    });

    it('does not filter on an empty already-claimed set (still queries CONSUMED/IN_WARRANTY/supplier/period filters)', async () => {
      candidatesQb.getMany.mockResolvedValue([reservationCandidate()]);
      await service.aggregate({ supplier: 'Samsung Gulf FZE', periodStart: '2026-08-01', periodEnd: '2026-08-31' } as any, 'clerk-1');

      expect(candidatesQb.where).toHaveBeenCalledWith('r.status = :status', { status: ReservationStatus.CONSUMED });
      expect(candidatesQb.andWhere).toHaveBeenCalledWith('jc.warrantyStatus = :iw', { iw: WarrantyStatus.IN_WARRANTY });
      expect(candidatesQb.andWhere).toHaveBeenCalledWith('jc.warrantySupplier = :supplier', { supplier: 'Samsung Gulf FZE' });
      expect(candidatesQb.andWhere).toHaveBeenCalledWith('1=1', { claimed: [] });
    });

    it('joins InventoryReservation to JobCard via the real jobCard relation, not a raw entity join (regression: TypeORM never hydrates an entity-class join with a manual ON condition)', async () => {
      candidatesQb.getMany.mockResolvedValue([reservationCandidate()]);
      await service.aggregate({ supplier: 'Samsung Gulf FZE', periodStart: '2026-08-01', periodEnd: '2026-08-31' } as any, 'clerk-1');

      expect(candidatesQb.innerJoinAndSelect).toHaveBeenCalledWith('r.jobCard', 'jc');
      expect(candidatesQb.innerJoinAndSelect).toHaveBeenCalledWith('r.sparePart', 'sp');
    });

    it('re-fetches its own result through the transactional manager, never through the injected Repository (regression: a Repository-based read runs on a different DB connection and 404s on the just-inserted, not-yet-committed row - caught live via warranty-claims-e2e-test.ps1)', async () => {
      candidatesQb.getMany.mockResolvedValue([reservationCandidate()]);
      await service.aggregate({ supplier: 'Samsung Gulf FZE', periodStart: '2026-08-01', periodEnd: '2026-08-31' } as any, 'clerk-1');

      expect(manager.findOne).toHaveBeenCalledWith(WarrantyClaim, expect.objectContaining({ relations: { lines: true } }));
      expect(warrantyClaimRepository.findOne).not.toHaveBeenCalled();
    });

    it('computes totalClaimedAmount from unitCost * quantityReserved across all candidates', async () => {
      candidatesQb.getMany.mockResolvedValue([
        reservationCandidate({ id: 'res-1', sparePart: { code: 'SP-1', name: 'Compressor', unitCost: 100 }, quantityReserved: 2 }),
        reservationCandidate({ id: 'res-2', sparePart: { code: 'SP-2', name: 'Fan Motor', unitCost: 50 }, quantityReserved: 1 }),
      ]);

      let savedClaim: any;
      manager.save = jest.fn((data) => {
        if (data && data.claimNumber) savedClaim = data;
        return Promise.resolve(data);
      });

      await service.aggregate({ supplier: 'Samsung Gulf FZE', periodStart: '2026-08-01', periodEnd: '2026-08-31' } as any, 'clerk-1');

      expect(savedClaim.totalClaimedAmount).toBe(250); // (100*2) + (50*1)
    });

    it('snapshots jobCardNumber/serialNumber from the joined jobCard onto each claim line (regression: previously read from a raw-joined alias that TypeORM never attached, silently saving empty strings)', async () => {
      candidatesQb.getMany.mockResolvedValue([
        reservationCandidate({
          id: 'res-1',
          jobCard: { jobCardNumber: 'JC-0042', serialNumber: 'SN-9988' },
          sparePart: { code: 'SP-1', name: 'Compressor Unit', unitCost: 100 },
        }),
      ]);

      let savedLines: any[] = [];
      manager.save = jest.fn((data) => {
        if (Array.isArray(data)) savedLines = data;
        return Promise.resolve(data);
      });

      await service.aggregate({ supplier: 'Samsung Gulf FZE', periodStart: '2026-08-01', periodEnd: '2026-08-31' } as any, 'clerk-1');

      expect(savedLines).toHaveLength(1);
      expect(savedLines[0].jobCardNumber).toBe('JC-0042');
      expect(savedLines[0].serialNumber).toBe('SN-9988');
      expect(savedLines[0].sparePartCode).toBe('SP-1');
      expect(savedLines[0].inventoryReservationId).toBe('res-1');
      expect(savedLines[0].lineAmount).toBe(200);
    });

    it('generates the next sequential WC-#### claim number', async () => {
      claimNumberQueryBuilder.getOne.mockResolvedValue({ claimNumber: 'WC-0007' });
      candidatesQb.getMany.mockResolvedValue([reservationCandidate()]);

      let savedClaim: any;
      manager.save = jest.fn((data) => {
        if (data && data.claimNumber) savedClaim = data;
        return Promise.resolve(data);
      });

      await service.aggregate({ supplier: 'Samsung Gulf FZE', periodStart: '2026-08-01', periodEnd: '2026-08-31' } as any, 'clerk-1');
      expect(savedClaim.claimNumber).toBe('WC-0008');
    });
  });

  describe('findById', () => {
    it('throws NotFoundException when missing', async () => {
      warrantyClaimRepository.findOne.mockResolvedValue(null);
      await expect(service.findById('missing')).rejects.toThrow(NotFoundException);
    });

    it('returns the claim with its lines relation when found', async () => {
      warrantyClaimRepository.findOne.mockResolvedValue(claim());
      const result = await service.findById('claim-1');
      expect(result.id).toBe('claim-1');
      expect(warrantyClaimRepository.findOne).toHaveBeenCalledWith({ where: { id: 'claim-1' }, relations: { lines: true } });
    });
  });

  describe('findAll', () => {
    it('passes supplier and status filters through when both are given', async () => {
      await service.findAll({ supplier: 'Samsung Gulf FZE', status: WarrantyClaimStatus.SUBMITTED });
      expect(warrantyClaimRepository.find).toHaveBeenCalledWith({
        where: { supplier: 'Samsung Gulf FZE', status: WarrantyClaimStatus.SUBMITTED },
        order: { createdAt: 'DESC' },
      });
    });

    it('omits filters that are not given', async () => {
      await service.findAll({});
      expect(warrantyClaimRepository.find).toHaveBeenCalledWith({ where: {}, order: { createdAt: 'DESC' } });
    });
  });

  describe('submit', () => {
    it('throws if the claim is not DRAFT', async () => {
      warrantyClaimRepository.findOne.mockResolvedValue(claim({ status: WarrantyClaimStatus.SUBMITTED }));
      await expect(service.submit('claim-1', { claimReferenceNumber: 'VENDOR-1' } as any, 'clerk-1')).rejects.toThrow(BadRequestException);
    });

    it('sets SUBMITTED, records the reference number and submitter', async () => {
      warrantyClaimRepository.findOne.mockResolvedValue(claim());
      await service.submit('claim-1', { claimReferenceNumber: 'VENDOR-CLM-2026-0912', notes: 'uploaded' } as any, 'clerk-1');

      expect(warrantyClaimRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: WarrantyClaimStatus.SUBMITTED,
          claimReferenceNumber: 'VENDOR-CLM-2026-0912',
          notes: 'uploaded',
          submittedByUserId: 'clerk-1',
        }),
      );
    });
  });

  describe('cancel (the-fool finding #3: DRAFT dead-end fix)', () => {
    it('throws if the claim is not DRAFT', async () => {
      warrantyClaimRepository.findOne.mockResolvedValue(claim({ status: WarrantyClaimStatus.SUBMITTED }));
      await expect(service.cancel('claim-1', { reason: 'wrong period' } as any)).rejects.toThrow(BadRequestException);
      expect(warrantyClaimLineRepository.delete).not.toHaveBeenCalled();
    });

    it('deletes the claim lines and sets CANCELLED + reason, returning reservations to the claimable pool', async () => {
      warrantyClaimRepository.findOne.mockResolvedValue(claim());
      await service.cancel('claim-1', { reason: 'wrong period selected' } as any);

      expect(warrantyClaimLineRepository.delete).toHaveBeenCalledWith({ warrantyClaimId: 'claim-1' });
      expect(warrantyClaimRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: WarrantyClaimStatus.CANCELLED, cancellationReason: 'wrong period selected' }),
      );
    });
  });

  describe('recordCreditNote', () => {
    it('throws if the claim is not SUBMITTED', async () => {
      warrantyClaimRepository.findOne.mockResolvedValue(claim({ status: WarrantyClaimStatus.DRAFT }));
      await expect(
        service.recordCreditNote('claim-1', { creditNoteNumber: 'CN-1', creditNoteAmount: 200 } as any, 'accountant-1'),
      ).rejects.toThrow(BadRequestException);
      expect(glLedgerService.postWarrantyCreditNote).not.toHaveBeenCalled();
    });

    it('sets CREDIT_RECEIVED and posts the GL entry (Debit Vendor Payable / Credit Warranty Recovery Account)', async () => {
      warrantyClaimRepository.findOne.mockResolvedValue(claim({ status: WarrantyClaimStatus.SUBMITTED, claimNumber: 'WC-0001' }));

      await service.recordCreditNote('claim-1', { creditNoteNumber: 'CN-2026-4471', creditNoteAmount: 180 } as any, 'accountant-1');

      // Regression: this used to assert against manager.save() inside a transaction whose
      // final this.findById() read stale pre-update data from a different DB connection
      // than the one the transaction's own write ran on (caught live via
      // warranty-claims-e2e-test.ps1). recordCreditNote() no longer wraps a single-row
      // save in a transaction at all - it saves directly through the injected Repository,
      // same as submit()/cancel() above.
      expect(warrantyClaimRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: WarrantyClaimStatus.CREDIT_RECEIVED,
          creditNoteNumber: 'CN-2026-4471',
          creditNoteAmount: 180,
          creditReceivedByUserId: 'accountant-1',
        }),
      );
      expect(glLedgerService.postWarrantyCreditNote).toHaveBeenCalledWith({
        warrantyClaimId: 'claim-1',
        claimNumber: 'WC-0001',
        amount: 180,
      });
    });
  });

  describe('recoveryRate (the-fool finding #4: null-guarded, dual-status denominator)', () => {
    it('returns rate: null when nothing has been claimed yet', async () => {
      warrantyClaimRepository.find.mockResolvedValue([]);
      const result = await service.recoveryRate({});
      expect(result.rate).toBeNull();
      expect(result.totalClaimed).toBe(0);
      expect(result.totalRecovered).toBe(0);
    });

    it('denominator sums SUBMITTED + CREDIT_RECEIVED claimed amounts, excluding DRAFT and CANCELLED entirely', async () => {
      warrantyClaimRepository.find
        .mockResolvedValueOnce([claim({ status: WarrantyClaimStatus.SUBMITTED, totalClaimedAmount: 300 })]) // SUBMITTED query
        .mockResolvedValueOnce([claim({ status: WarrantyClaimStatus.CREDIT_RECEIVED, totalClaimedAmount: 200, creditNoteAmount: 150 })]); // CREDIT_RECEIVED query

      const result = await service.recoveryRate({});

      expect(result.totalClaimed).toBe(500); // 300 (SUBMITTED) + 200 (CREDIT_RECEIVED) - DRAFT/CANCELLED never queried for
      expect(result.totalRecovered).toBe(150); // only creditNoteAmount from CREDIT_RECEIVED
      expect(result.rate).toBe(30); // 150 / 500 * 100
    });

    it('scopes both the SUBMITTED and CREDIT_RECEIVED lookups to the given supplier', async () => {
      warrantyClaimRepository.find.mockResolvedValue([]);
      await service.recoveryRate({ supplier: 'Samsung Gulf FZE' });

      expect(warrantyClaimRepository.find).toHaveBeenCalledWith({
        where: { status: WarrantyClaimStatus.SUBMITTED, supplier: 'Samsung Gulf FZE' },
      });
      expect(warrantyClaimRepository.find).toHaveBeenCalledWith({
        where: { status: WarrantyClaimStatus.CREDIT_RECEIVED, supplier: 'Samsung Gulf FZE' },
      });
    });
  });
});
