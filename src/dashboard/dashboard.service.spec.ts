import { DashboardService } from './dashboard.service';
import { RoleName } from '../auth/entities/role.entity';

describe('DashboardService', () => {
  let service: DashboardService;
  let rolePermissionsService: any;
  let reportsService: any;
  let operationalReportsService: any;
  let technicianScheduleService: any;

  const caller = (roleName: RoleName = RoleName.TECHNICAL_TEAM_LEADER) =>
    ({ id: 'user-1', role: { id: 'role-1', name: roleName } } as any);

  const kanbanSummary = {
    columns: [
      { key: 'SCHEDULED', label: 'Scheduled', count: 2 },
      { key: 'WIP', label: 'WIP', count: 5 },
    ],
    totalActiveJobs: 7,
  };

  const workshopQueue = {
    technicians: [
      { id: 't-1', name: 'Alice', capacity: 6, activeCount: 4, overCapacity: false, jobs: [] },
      { id: 't-2', name: 'Bob', capacity: 6, activeCount: 8, overCapacity: true, jobs: [] },
    ],
    unassignedJobCards: [{ id: 'jc-1' }],
  };

  const slaBreach = {
    asOf: new Date('2026-09-15T00:00:00Z'),
    thresholdHours: 48,
    breachedCount: 2,
    items: [
      { jobCardId: 'jc-1', jobCardNumber: 'JC-0001', hoursOverThreshold: 3, hoursElapsed: 51 },
      { jobCardId: 'jc-2', jobCardNumber: 'JC-0002', hoursOverThreshold: 10, hoursElapsed: 58 },
    ],
  };

  const spareConsumption = {
    periodStart: null,
    periodEnd: null,
    topByQuantity: [
      { sparePartId: 'sp-1', code: 'C1', name: 'Compressor', totalQuantity: 9, totalValue: 900 },
      { sparePartId: 'sp-2', code: 'C2', name: 'Fan Motor', totalQuantity: 4, totalValue: 400 },
    ],
    topByValue: [{ sparePartId: 'sp-1', code: 'C1', name: 'Compressor', totalQuantity: 9, totalValue: 900 }],
    byModel: [],
    byWarrantyStatus: [],
  };

  beforeEach(() => {
    rolePermissionsService = { userHasCapability: jest.fn().mockResolvedValue(true) };
    reportsService = { getKanbanSummary: jest.fn().mockResolvedValue(kanbanSummary) };
    operationalReportsService = {
      getSlaBreach: jest.fn().mockResolvedValue(slaBreach),
      getSpareConsumption: jest.fn().mockResolvedValue(spareConsumption),
    };
    technicianScheduleService = { getWorkshopQueue: jest.fn().mockResolvedValue(workshopQueue) };

    service = new DashboardService(
      rolePermissionsService,
      reportsService,
      operationalReportsService,
      technicianScheduleService,
    );
  });

  it('includes every widget when the caller holds all four capabilities', async () => {
    const result = await service.getOverview(caller());

    expect(result.widgets.jobsByStatus).toEqual({
      columns: kanbanSummary.columns,
      totalActiveJobs: 7,
    });
    expect(result.widgets.workshopQueue).toEqual({
      technicians: [
        { id: 't-1', name: 'Alice', activeCount: 4, capacity: 6, overCapacity: false },
        { id: 't-2', name: 'Bob', activeCount: 8, capacity: 6, overCapacity: true },
      ],
      totalActive: 12,
      unassignedCount: 1,
    });
    expect(result.widgets.slaBreach).toEqual({
      asOf: slaBreach.asOf,
      thresholdHours: 48,
      breachedCount: 2,
      // sorted descending by hoursOverThreshold, not left in source order
      topItems: [
        { jobCardId: 'jc-2', jobCardNumber: 'JC-0002', hoursOverThreshold: 10 },
        { jobCardId: 'jc-1', jobCardNumber: 'JC-0001', hoursOverThreshold: 3 },
      ],
    });
    expect(result.widgets.spareConsumption).toEqual({
      topByQuantity: [
        { sparePartId: 'sp-1', code: 'C1', name: 'Compressor', totalQuantity: 9 },
        { sparePartId: 'sp-2', code: 'C2', name: 'Fan Motor', totalQuantity: 4 },
      ],
      topByValue: [{ sparePartId: 'sp-1', code: 'C1', name: 'Compressor', totalValue: 900 }],
    });
  });

  it('omits a widget entirely (not just empties it) when the caller lacks its capability', async () => {
    rolePermissionsService.userHasCapability.mockImplementation((_user: any, key: string) =>
      Promise.resolve(key !== 'DASHBOARD_WIDGET_SLA_BREACH'),
    );

    const result = await service.getOverview(caller());

    expect(result.widgets.slaBreach).toBeUndefined();
    expect(operationalReportsService.getSlaBreach).not.toHaveBeenCalled();
    expect(result.widgets.jobsByStatus).toBeDefined();
    expect(result.widgets.workshopQueue).toBeDefined();
    expect(result.widgets.spareConsumption).toBeDefined();
  });

  it('returns an empty widgets object (never throws) when the caller holds none of the four capabilities', async () => {
    rolePermissionsService.userHasCapability.mockResolvedValue(false);

    const result = await service.getOverview(caller(RoleName.WAREHOUSE_CLERK));

    expect(result.widgets).toEqual({});
    expect(reportsService.getKanbanSummary).not.toHaveBeenCalled();
    expect(technicianScheduleService.getWorkshopQueue).not.toHaveBeenCalled();
    expect(operationalReportsService.getSlaBreach).not.toHaveBeenCalled();
    expect(operationalReportsService.getSpareConsumption).not.toHaveBeenCalled();
  });

  it('passes the caller through to getKanbanSummary and getWorkshopQueue for their own self-scoping', async () => {
    const plainTechCaller = caller(RoleName.TECHNICIAN_WORKSHOP);
    await service.getOverview(plainTechCaller);

    expect(reportsService.getKanbanSummary).toHaveBeenCalledWith(plainTechCaller);
    expect(technicianScheduleService.getWorkshopQueue).toHaveBeenCalledWith(plainTechCaller);
  });

  it('caps SLA breach topItems and spare consumption lists at 5 entries', async () => {
    const manyItems = Array.from({ length: 8 }, (_, i) => ({
      jobCardId: `jc-${i}`,
      jobCardNumber: `JC-000${i}`,
      hoursOverThreshold: i,
      hoursElapsed: 48 + i,
    }));
    operationalReportsService.getSlaBreach.mockResolvedValue({ ...slaBreach, items: manyItems });

    const manySpares = Array.from({ length: 8 }, (_, i) => ({
      sparePartId: `sp-${i}`,
      code: `C${i}`,
      name: `Part ${i}`,
      totalQuantity: i,
      totalValue: i * 10,
    }));
    operationalReportsService.getSpareConsumption.mockResolvedValue({
      ...spareConsumption,
      topByQuantity: manySpares,
      topByValue: manySpares,
    });

    const result = await service.getOverview(caller());

    expect(result.widgets.slaBreach!.topItems).toHaveLength(5);
    expect(result.widgets.spareConsumption!.topByQuantity).toHaveLength(5);
    expect(result.widgets.spareConsumption!.topByValue).toHaveLength(5);
  });
});
