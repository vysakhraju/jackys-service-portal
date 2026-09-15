import { DashboardController } from './dashboard.controller';

describe('DashboardController', () => {
  it('delegates getOverview to DashboardService.getOverview with the current user', () => {
    const dashboardService = { getOverview: jest.fn().mockResolvedValue({ widgets: {} }) };
    const controller = new DashboardController(dashboardService as any);
    const user = { id: 'user-1', role: { id: 'role-1', name: 'CCE' } } as any;

    controller.getOverview(user);

    expect(dashboardService.getOverview).toHaveBeenCalledWith(user);
  });
});
