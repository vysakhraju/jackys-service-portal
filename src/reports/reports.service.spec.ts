import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In } from 'typeorm';
import { ReportsService, KanbanColumn } from './reports.service';
import { JobCard, JobCardStatus, JobCardSection } from '../job-cards/entities/job-card.entity';
import { Delivery } from '../delivery/entities/delivery.entity';
import { Estimate, EstimateStatus } from '../estimates/entities/estimate.entity';
import { TechnicianVisit } from '../technician/entities/technician-visit.entity';
import { FaultSymptom, ApplianceCategory } from '../master-data/entities/fault-symptom.entity';
import { User } from '../auth/entities/user.entity';
import { Appointment } from '../appointments/entities/appointment.entity';
import { WarrantyStatus } from '../technician/entities/technician-visit.entity';

function mockQueryBuilder(rawRows: any[]) {
  const qb: any = {
    innerJoin: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue(rawRows),
  };
  return qb;
}

describe('ReportsService', () => {
  let service: ReportsService;
  let jobCardRepo: { find: jest.Mock; count: jest.Mock; createQueryBuilder: jest.Mock };
  let deliveryRepo: { find: jest.Mock };
  let estimateRepo: { find: jest.Mock };
  let faultSymptomRepo: { find: jest.Mock };
  let userRepo: { find: jest.Mock };
  let appointmentRepo: { find: jest.Mock };

  const baseJob = (overrides: Partial<JobCard> = {}): JobCard =>
    ({
      id: 'jc-1',
      jobCardNumber: 'JC-0001',
      status: JobCardStatus.OPEN,
      section: null,
      serialNumber: 'SN123',
      brand: 'Samsung',
      warrantyStatus: WarrantyStatus.IN_WARRANTY,
      deliveryId: null,
      updatedAt: new Date('2026-08-20T10:00:00Z'),
      ...overrides,
    }) as JobCard;

  beforeEach(async () => {
    jobCardRepo = { find: jest.fn(), count: jest.fn(), createQueryBuilder: jest.fn() };
    deliveryRepo = { find: jest.fn() };
    estimateRepo = { find: jest.fn() };
    faultSymptomRepo = { find: jest.fn() };
    userRepo = { find: jest.fn() };
    appointmentRepo = { find: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: getRepositoryToken(JobCard), useValue: jobCardRepo },
        { provide: getRepositoryToken(Delivery), useValue: deliveryRepo },
        { provide: getRepositoryToken(Estimate), useValue: estimateRepo },
        { provide: getRepositoryToken(TechnicianVisit), useValue: {} },
        { provide: getRepositoryToken(FaultSymptom), useValue: faultSymptomRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(Appointment), useValue: appointmentRepo },
      ],
    }).compile();

    service = module.get(ReportsService);
  });

  describe('columnForJobCard', () => {
    it.each([
      [JobCardStatus.OPEN, null, null, KanbanColumn.SCHEDULED],
      [JobCardStatus.SN_VALIDATED, null, null, KanbanColumn.SCHEDULED],
      [JobCardStatus.RWR, null, null, KanbanColumn.APPROVAL_PENDING],
      [JobCardStatus.SECTION_ASSIGNED, JobCardSection.ON_SITE_REPAIR, null, KanbanColumn.ON_SITE],
      [JobCardStatus.SECTION_ASSIGNED, JobCardSection.WORKSHOP, null, KanbanColumn.WIP],
      [JobCardStatus.WORKSHOP_ASSIGNED, JobCardSection.WORKSHOP, null, KanbanColumn.WIP],
      [JobCardStatus.IN_PROGRESS, JobCardSection.WORKSHOP, null, KanbanColumn.WIP],
      [JobCardStatus.READY_FOR_QC, JobCardSection.WORKSHOP, null, KanbanColumn.WIP],
      [JobCardStatus.SPARE_PENDING, JobCardSection.WORKSHOP, null, KanbanColumn.SPARE_PENDING],
      [JobCardStatus.QC_PASSED, JobCardSection.WORKSHOP, null, KanbanColumn.QC_COMPLETED],
      [JobCardStatus.QC_PASSED, JobCardSection.WORKSHOP, 'dlv-1', KanbanColumn.OUT_FOR_DELIVERY],
      [JobCardStatus.DELIVERED, JobCardSection.WORKSHOP, 'dlv-1', KanbanColumn.DELIVERED],
      [JobCardStatus.CANCELLED, JobCardSection.WORKSHOP, null, null],
    ])('maps status=%s section=%s deliveryId=%s -> %s', (status, section, deliveryId, expected) => {
      expect(service.columnForJobCard({ status, section, deliveryId } as any)).toBe(expected);
    });
  });

  describe('getKanbanBoard / getKanbanSummary', () => {
    it('buckets active job cards into columns and excludes CANCELLED', async () => {
      const jobs = [
        baseJob({ id: '1', status: JobCardStatus.OPEN }),
        baseJob({ id: '2', status: JobCardStatus.SPARE_PENDING }),
        baseJob({ id: '3', status: JobCardStatus.QC_PASSED, deliveryId: 'dlv-1' }),
        baseJob({ id: '4', status: JobCardStatus.CANCELLED }),
      ];
      jobCardRepo.find.mockResolvedValue(jobs);
      deliveryRepo.find.mockResolvedValue([{ id: 'dlv-1', deliveryNumber: 'DLV-0001' }]);

      const board = await service.getKanbanBoard();

      expect(board.totalActiveJobs).toBe(3);
      const scheduled = board.columns.find((c) => c.key === KanbanColumn.SCHEDULED)!;
      expect(scheduled.count).toBe(1);
      const outForDelivery = board.columns.find((c) => c.key === KanbanColumn.OUT_FOR_DELIVERY)!;
      expect(outForDelivery.jobCards[0].deliveryNumber).toBe('DLV-0001');
      // CANCELLED never appears in any bucket
      const allCardIds = board.columns.flatMap((c) => c.jobCards.map((jc) => jc.jobCardId));
      expect(allCardIds).not.toContain('4');
    });

    it('summary counts match the full board counts', async () => {
      const jobs = [
        baseJob({ id: '1', status: JobCardStatus.OPEN }),
        baseJob({ id: '2', status: JobCardStatus.DELIVERED }),
      ];
      jobCardRepo.find.mockResolvedValue(jobs);
      const summary = await service.getKanbanSummary();
      expect(summary.totalActiveJobs).toBe(2);
      expect(summary.columns.find((c) => c.key === KanbanColumn.DELIVERED)!.count).toBe(1);
    });
  });

  describe('Live Job Status Board self-scoping (2026-09-14, live-tested finding)', () => {
    const teamLeaderCaller = { id: 'tl-1', role: { name: 'TECHNICAL_TEAM_LEADER' } } as unknown as User;
    const workshopTechCaller = { id: 'wtech-1', role: { name: 'TECHNICIAN_WORKSHOP' } } as unknown as User;
    const fieldTechCaller = { id: 'ftech-1', role: { name: 'TECHNICIAN_FIELD' } } as unknown as User;

    it('a TL+/CCE-with-access caller sees the whole board, unfiltered', async () => {
      const jobs = [baseJob({ id: '1', status: JobCardStatus.OPEN }), baseJob({ id: '2', status: JobCardStatus.SPARE_PENDING })];
      jobCardRepo.find.mockResolvedValue(jobs);

      const board = await service.getKanbanBoard(teamLeaderCaller);

      expect(board.totalActiveJobs).toBe(2);
      // No caller-identity lookup happened for a non-technician caller.
      expect(appointmentRepo.find).not.toHaveBeenCalled();
    });

    it('a plain workshop technician caller only sees job cards assigned to them', async () => {
      // First call: fetch own job card ids via assignedWorkshopTechnicianId. Second call:
      // the actual board query, scoped to those ids.
      jobCardRepo.find.mockResolvedValueOnce([{ id: 'jc-mine' }]).mockResolvedValueOnce([baseJob({ id: 'jc-mine', status: JobCardStatus.IN_PROGRESS })]);

      const board = await service.getKanbanBoard(workshopTechCaller);

      expect(jobCardRepo.find).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ where: { assignedWorkshopTechnicianId: 'wtech-1' } }),
      );
      expect(jobCardRepo.find).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ where: expect.objectContaining({ id: In(['jc-mine']) }) }),
      );
      expect(board.totalActiveJobs).toBe(1);
    });

    it('a plain workshop technician caller with zero assigned jobs gets an empty board without querying further', async () => {
      jobCardRepo.find.mockResolvedValueOnce([]); // no job cards assigned to this technician

      const board = await service.getKanbanBoard(workshopTechCaller);

      expect(jobCardRepo.find).toHaveBeenCalledTimes(1); // never issued the second (unnecessary) query
      expect(board.totalActiveJobs).toBe(0);
    });

    it('a plain field technician caller is scoped via their own appointments, not every appointment', async () => {
      appointmentRepo.find.mockResolvedValue([{ id: 'apt-1' }, { id: 'apt-2' }]);
      jobCardRepo.find
        .mockResolvedValueOnce([{ id: 'jc-mine' }])
        .mockResolvedValueOnce([baseJob({ id: 'jc-mine', status: JobCardStatus.OPEN })]);

      const summary = await service.getKanbanSummary(fieldTechCaller);

      expect(appointmentRepo.find).toHaveBeenCalledWith(expect.objectContaining({ where: { technicianId: 'ftech-1' } }));
      expect(summary.totalActiveJobs).toBe(1);
    });

    it('a plain field technician caller with no appointments at all gets an empty board, never a 500 from an empty IN()', async () => {
      appointmentRepo.find.mockResolvedValue([]);

      const summary = await service.getKanbanSummary(fieldTechCaller);

      expect(jobCardRepo.find).not.toHaveBeenCalled();
      expect(summary.totalActiveJobs).toBe(0);
    });

    it('getOverview only self-scopes the kanbanSummary slice, for a plain technician caller', async () => {
      jobCardRepo.find.mockResolvedValueOnce([]); // workshop tech: zero assigned jobs
      estimateRepo.find.mockResolvedValue([]);
      jobCardRepo.count = jest.fn().mockResolvedValue(0);
      jobCardRepo.createQueryBuilder = jest.fn().mockReturnValue(mockQueryBuilder([]));
      faultSymptomRepo.find.mockResolvedValue([]);

      const overview = await service.getOverview(workshopTechCaller);

      expect(overview.kanbanSummary.totalActiveJobs).toBe(0);
    });
  });

  describe('getApprovalAging', () => {
    it('flags estimates sent more than 4 hours ago as breached', async () => {
      const now = Date.now();
      const oldEstimate = {
        id: 'est-1',
        jobCardId: 'jc-1',
        status: EstimateStatus.SENT,
        sentAt: new Date(now - 5 * 3_600_000),
        respondedAt: null,
      };
      const freshEstimate = {
        id: 'est-2',
        jobCardId: 'jc-2',
        status: EstimateStatus.SENT,
        sentAt: new Date(now - 1 * 3_600_000),
        respondedAt: null,
      };
      estimateRepo.find.mockResolvedValue([oldEstimate, freshEstimate]);
      jobCardRepo.find.mockResolvedValue([
        { id: 'jc-1', jobCardNumber: 'JC-0001' },
        { id: 'jc-2', jobCardNumber: 'JC-0002' },
      ]);

      const report = await service.getApprovalAging();

      expect(report.thresholdHours).toBe(4);
      expect(report.breachedCount).toBe(1);
      expect(report.items.find((i) => i.estimateId === 'est-1')!.breached).toBe(true);
      expect(report.items.find((i) => i.estimateId === 'est-2')!.breached).toBe(false);
    });

    it('returns an empty report when nothing is pending', async () => {
      estimateRepo.find.mockResolvedValue([]);
      const report = await service.getApprovalAging();
      expect(report.breachedCount).toBe(0);
      expect(report.items).toHaveLength(0);
      expect(jobCardRepo.find).not.toHaveBeenCalled();
    });
  });

  describe('getServiceEfficiency', () => {
    it('groups avg hours by technician and by category', async () => {
      const now = new Date('2026-08-20T12:00:00Z');
      const rows = [
        {
          jobCardId: 'jc-1',
          faultCode: 'FLT-01',
          qcApprovedAt: now,
          technicianId: 'tech-1',
          startedAt: new Date(now.getTime() - 2 * 3_600_000), // 2h
        },
        {
          jobCardId: 'jc-2',
          faultCode: 'FLT-01',
          qcApprovedAt: now,
          technicianId: 'tech-1',
          startedAt: new Date(now.getTime() - 4 * 3_600_000), // 4h
        },
      ];
      jobCardRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder(rows));
      faultSymptomRepo.find.mockResolvedValue([{ faultCode: 'FLT-01', category: ApplianceCategory.REFRIGERATOR }]);
      userRepo.find.mockResolvedValue([{ id: 'tech-1', firstName: 'Ravi', lastName: 'Kumar' }]);

      const report = await service.getServiceEfficiency();

      expect(report.sampleSize).toBe(2);
      expect(report.overallAvgHours).toBe(3);
      expect(report.byTechnician[0]).toMatchObject({ key: 'tech-1', label: 'Ravi Kumar', jobCount: 2, avgHours: 3 });
      expect(report.byCategory[0]).toMatchObject({ key: ApplianceCategory.REFRIGERATOR, jobCount: 2, avgHours: 3 });
    });

    it('falls back to OTHER category for an unmapped fault code', async () => {
      const now = new Date('2026-08-20T12:00:00Z');
      const rows = [
        { jobCardId: 'jc-1', faultCode: 'UNKNOWN', qcApprovedAt: now, technicianId: 'tech-1', startedAt: new Date(now.getTime() - 1 * 3_600_000) },
      ];
      jobCardRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder(rows));
      faultSymptomRepo.find.mockResolvedValue([]);
      userRepo.find.mockResolvedValue([{ id: 'tech-1', firstName: 'Ravi', lastName: 'Kumar' }]);

      const report = await service.getServiceEfficiency();
      expect(report.byCategory[0].key).toBe(ApplianceCategory.OTHER);
    });

    it('returns nulls/empties when there is no completed work yet', async () => {
      jobCardRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder([]));
      faultSymptomRepo.find.mockResolvedValue([]);
      userRepo.find.mockResolvedValue([]);

      const report = await service.getServiceEfficiency();
      expect(report.overallAvgHours).toBeNull();
      expect(report.sampleSize).toBe(0);
      expect(report.byTechnician).toHaveLength(0);
    });
  });

  describe('getFirstTimeFixRate', () => {
    it('computes the ratio of on-site-only completions to total completions', async () => {
      jobCardRepo.count.mockResolvedValueOnce(10).mockResolvedValueOnce(4);
      const report = await service.getFirstTimeFixRate();
      expect(report.totalCompletedJobs).toBe(10);
      expect(report.onSiteOnlyCompletedJobs).toBe(4);
      expect(report.rate).toBe(0.4);
    });

    it('returns a null rate rather than dividing by zero when nothing is completed yet', async () => {
      jobCardRepo.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
      const report = await service.getFirstTimeFixRate();
      expect(report.rate).toBeNull();
    });
  });

  describe('getOverview', () => {
    it('composes all four widgets into one payload', async () => {
      jobCardRepo.find.mockResolvedValue([baseJob({ id: '1', status: JobCardStatus.OPEN })]);
      estimateRepo.find.mockResolvedValue([]);
      jobCardRepo.count.mockResolvedValueOnce(5).mockResolvedValueOnce(2);
      jobCardRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder([]));
      faultSymptomRepo.find.mockResolvedValue([]);
      userRepo.find.mockResolvedValue([]);

      const overview = await service.getOverview();

      expect(overview.kanbanSummary.totalActiveJobs).toBe(1);
      expect(overview.approvalAging.breachedCount).toBe(0);
      expect(overview.approvalAging.oldestAgeHours).toBeNull();
      expect(overview.firstTimeFixRate.rate).toBe(0.4);
      expect(overview.serviceEfficiency.sampleSize).toBe(0);
    });
  });
});
