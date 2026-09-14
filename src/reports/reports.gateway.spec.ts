import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ReportsGateway } from './reports.gateway';
import { ReportsService } from './reports.service';
import { RolePermissionsService } from '../auth/role-permissions.service';
import { RoleAccessService } from '../auth/role-access.service';
import { User, UserStatus } from '../auth/entities/user.entity';
import { RoleName } from '../auth/entities/role.entity';

// Live-tested finding (2026-09-14): handleConnection used to check a second, independent
// hardcoded VIEW_ROLES list instead of the designation permission matrix - so granting
// REPORTS_DASHBOARD_VIEW to a role via Designation access made GET /reports/overview work
// for them but left the live Kanban WebSocket permanently rejecting the same user. These
// tests pin down the fix: the handshake now asks RolePermissionsService/RoleAccessService,
// the exact same sources of truth RolesGuard.checkCapability uses for the REST endpoint.
function buildSocket() {
  return {
    handshake: { auth: { token: 'a-token' }, headers: {}, query: {} },
    data: {} as Record<string, unknown>,
    join: jest.fn(),
    emit: jest.fn(),
    disconnect: jest.fn(),
  } as any;
}

function buildUser(overrides: Partial<{ roleId: string; roleName: RoleName; status: UserStatus }> = {}): User {
  return {
    id: 'user-1',
    status: overrides.status ?? UserStatus.ACTIVE,
    role: { id: overrides.roleId ?? 'role-1', name: overrides.roleName ?? RoleName.CCE, displayName: 'CCE' },
  } as User;
}

describe('ReportsGateway.handleConnection', () => {
  let gateway: ReportsGateway;
  let userRepoFindOne: jest.Mock;
  let jwtVerifyAsync: jest.Mock;
  let roleHasCapability: jest.Mock;
  let getGrantedRoleNames: jest.Mock;
  let hasActiveAccessToAnyRole: jest.Mock;
  let getKanbanBoard: jest.Mock;
  let getApprovalAging: jest.Mock;

  beforeEach(async () => {
    userRepoFindOne = jest.fn();
    jwtVerifyAsync = jest.fn().mockResolvedValue({ sub: 'user-1' });
    roleHasCapability = jest.fn();
    getGrantedRoleNames = jest.fn();
    hasActiveAccessToAnyRole = jest.fn();
    getKanbanBoard = jest.fn().mockResolvedValue({ columns: [], totalActiveJobs: 0, asOf: '2026-09-14T00:00:00.000Z' });
    getApprovalAging = jest.fn().mockResolvedValue({ items: [], breachedCount: 0, thresholdHours: 4, asOf: '2026-09-14T00:00:00.000Z' });

    const module = await Test.createTestingModule({
      providers: [
        ReportsGateway,
        { provide: ReportsService, useValue: { getKanbanBoard, getApprovalAging } },
        { provide: JwtService, useValue: { verifyAsync: jwtVerifyAsync } },
        { provide: ConfigService, useValue: { get: () => 'test-secret' } },
        { provide: getRepositoryToken(User), useValue: { findOne: userRepoFindOne } },
        { provide: RolePermissionsService, useValue: { roleHasCapability, getGrantedRoleNames } },
        { provide: RoleAccessService, useValue: { hasActiveAccessToAnyRole } },
      ],
    }).compile();

    gateway = module.get(ReportsGateway);
    // Silence the logger.warn on the rejection paths - the assertions below check the
    // actual socket behaviour (disconnect/emit), not log output.
    (gateway as any).logger = { warn: jest.fn(), error: jest.fn() };
  });

  it('admits a MATRIX_LOCKED_ROLES user (SUPER_ADMIN) without ever consulting the capability table', async () => {
    userRepoFindOne.mockResolvedValue(buildUser({ roleName: RoleName.SUPER_ADMIN }));
    const socket = buildSocket();

    await gateway.handleConnection(socket);

    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(socket.join).toHaveBeenCalledWith('dashboard');
    expect(roleHasCapability).not.toHaveBeenCalled();
  });

  it('admits a role holding a direct REPORTS_DASHBOARD_VIEW grant - the whole point of the fix', async () => {
    userRepoFindOne.mockResolvedValue(buildUser({ roleName: RoleName.CCE, roleId: 'role-cce' }));
    roleHasCapability.mockResolvedValue(true);
    const socket = buildSocket();

    await gateway.handleConnection(socket);

    expect(roleHasCapability).toHaveBeenCalledWith('role-cce', 'REPORTS_DASHBOARD_VIEW');
    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(socket.join).toHaveBeenCalledWith('dashboard');
    expect(socket.emit).toHaveBeenCalledWith('kanban:update', expect.anything());
  });

  it('admits a user via delegated "extra role access" to a role that holds the grant', async () => {
    userRepoFindOne.mockResolvedValue(buildUser({ roleName: RoleName.CCE, roleId: 'role-cce' }));
    roleHasCapability.mockResolvedValue(false);
    getGrantedRoleNames.mockResolvedValue([RoleName.TECHNICAL_TEAM_LEADER]);
    hasActiveAccessToAnyRole.mockResolvedValue(true);
    const socket = buildSocket();

    await gateway.handleConnection(socket);

    expect(hasActiveAccessToAnyRole).toHaveBeenCalledWith('user-1', [RoleName.TECHNICAL_TEAM_LEADER]);
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('rejects a role with no direct grant, no delegated access, and no bypass', async () => {
    userRepoFindOne.mockResolvedValue(buildUser({ roleName: RoleName.CCE, roleId: 'role-cce' }));
    roleHasCapability.mockResolvedValue(false);
    getGrantedRoleNames.mockResolvedValue([RoleName.TECHNICAL_TEAM_LEADER]);
    hasActiveAccessToAnyRole.mockResolvedValue(false);
    const socket = buildSocket();

    await gateway.handleConnection(socket);

    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Unauthorized' });
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('rejects (fails closed) when the capability lookup itself throws, rather than silently admitting', async () => {
    userRepoFindOne.mockResolvedValue(buildUser({ roleName: RoleName.CCE, roleId: 'role-cce' }));
    roleHasCapability.mockRejectedValue(new Error('DB down'));
    const socket = buildSocket();

    await gateway.handleConnection(socket);

    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('still rejects an inactive user before capability is even considered', async () => {
    userRepoFindOne.mockResolvedValue(buildUser({ status: UserStatus.SUSPENDED }));
    const socket = buildSocket();

    await gateway.handleConnection(socket);

    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(roleHasCapability).not.toHaveBeenCalled();
  });

  it('rejects when no token is present on the handshake at all', async () => {
    userRepoFindOne.mockResolvedValue(buildUser());
    const socket = buildSocket();
    socket.handshake.auth = {};

    await gateway.handleConnection(socket);

    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(jwtVerifyAsync).not.toHaveBeenCalled();
  });

  it('stashes the whole authenticated user on the socket, for pollAndBroadcastKanban to self-scope by later', async () => {
    const user = buildUser({ roleName: RoleName.SUPER_ADMIN });
    userRepoFindOne.mockResolvedValue(user);
    const socket = buildSocket();

    await gateway.handleConnection(socket);

    expect(socket.data.user).toBe(user);
  });

  // Live-tested finding (2026-09-14): getKanbanBoard/getKanbanSummary used to be called with
  // no argument at all here, and the single resulting board was broadcast identically to
  // every connected socket via .to(DASHBOARD_ROOM).emit(...) - so a plain technician granted
  // REPORTS_DASHBOARD_VIEW would see every OTHER technician's jobs too on every live update,
  // even though their initial page load (a separate, already-scoped REST call) showed only
  // their own. These tests pin down the fix: each connected socket's OWN stashed user is
  // passed through on every poll tick, and updates are emitted directly to that socket only,
  // never broadcast to the shared room.
  describe('pollAndBroadcastKanban (self-scoping, 2026-09-14)', () => {
    function buildConnectedSocket(id: string, user: User) {
      return { id, data: { user }, emit: jest.fn() } as any;
    }

    it('computes a separately-scoped summary/board per socket and emits only to that socket', async () => {
      const workshopTechUser = buildUser({ roleName: RoleName.TECHNICIAN_WORKSHOP, roleId: 'role-wtech' });
      workshopTechUser.id = 'wtech-1';
      const socket = buildConnectedSocket('sock-1', workshopTechUser);
      (gateway as any).server = { sockets: new Map([['sock-1', socket]]) };

      getKanbanBoard.mockResolvedValue({ columns: [{ key: 'WIP', label: 'WIP', count: 1, jobCards: [] }], totalActiveJobs: 1, asOf: new Date() });
      const getKanbanSummary = jest.fn().mockResolvedValue({ columns: [{ key: 'WIP', label: 'WIP', count: 1 }], totalActiveJobs: 1, asOf: new Date() });
      (gateway as any).reportsService.getKanbanSummary = getKanbanSummary;

      await (gateway as any).pollAndBroadcastKanban();

      expect(getKanbanSummary).toHaveBeenCalledWith(workshopTechUser);
      expect(getKanbanBoard).toHaveBeenCalledWith(workshopTechUser);
      expect(socket.emit).toHaveBeenCalledWith('kanban:update', expect.objectContaining({ totalActiveJobs: 1 }));
    });

    it('two different sockets with different scoped pictures each get their own update, independently', async () => {
      const userA = buildUser({ roleName: RoleName.TECHNICIAN_WORKSHOP });
      userA.id = 'wtech-a';
      const userB = buildUser({ roleName: RoleName.TECHNICIAN_WORKSHOP });
      userB.id = 'wtech-b';
      const socketA = buildConnectedSocket('sock-a', userA);
      const socketB = buildConnectedSocket('sock-b', userB);
      (gateway as any).server = { sockets: new Map([['sock-a', socketA], ['sock-b', socketB]]) };

      const getKanbanSummary = jest.fn().mockImplementation((u: User) =>
        Promise.resolve({
          columns: [{ key: 'WIP', label: 'WIP', count: u.id === 'wtech-a' ? 1 : 2 }],
          totalActiveJobs: u.id === 'wtech-a' ? 1 : 2,
          asOf: new Date(),
        }),
      );
      (gateway as any).reportsService.getKanbanSummary = getKanbanSummary;
      getKanbanBoard.mockImplementation((u: User) =>
        Promise.resolve({ columns: [], totalActiveJobs: u.id === 'wtech-a' ? 1 : 2, asOf: new Date() }),
      );

      await (gateway as any).pollAndBroadcastKanban();

      expect(socketA.emit).toHaveBeenCalledWith('kanban:update', expect.objectContaining({ totalActiveJobs: 1 }));
      expect(socketB.emit).toHaveBeenCalledWith('kanban:update', expect.objectContaining({ totalActiveJobs: 2 }));
    });

    it('skips a socket entirely when its own scoped signature has not changed, without touching other sockets', async () => {
      const user = buildUser({ roleName: RoleName.TECHNICAL_TEAM_LEADER });
      user.id = 'tl-1';
      const socket = buildConnectedSocket('sock-1', user);
      (gateway as any).server = { sockets: new Map([['sock-1', socket]]) };
      (gateway as any).lastSummarySignatureBySocket.set('sock-1', 'WIP:1');

      const getKanbanSummary = jest.fn().mockResolvedValue({ columns: [{ key: 'WIP', label: 'WIP', count: 1 }], totalActiveJobs: 1, asOf: new Date() });
      (gateway as any).reportsService.getKanbanSummary = getKanbanSummary;

      await (gateway as any).pollAndBroadcastKanban();

      expect(socket.emit).not.toHaveBeenCalled();
      expect(getKanbanBoard).not.toHaveBeenCalled();
    });

    it('clears a disconnected socket\'s stored signature so a later reconnect is never compared against stale state', () => {
      (gateway as any).lastSummarySignatureBySocket.set('sock-1', 'WIP:1');

      gateway.handleDisconnect({ id: 'sock-1' } as any);

      expect((gateway as any).lastSummarySignatureBySocket.has('sock-1')).toBe(false);
    });
  });
});
