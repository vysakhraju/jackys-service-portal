import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InventoryGateway } from './inventory.gateway';
import { InventoryService } from './inventory.service';
import { RolePermissionsService } from '../auth/role-permissions.service';
import { User, UserStatus } from '../auth/entities/user.entity';
import { RoleName } from '../auth/entities/role.entity';

// Group C (2026-09-14): handleConnection used to check a second, independent hardcoded
// VIEW_ROLES = ['TECHNICAL_TEAM_LEADER', 'SERVICE_HEAD', 'SUPER_ADMIN'] array instead of
// the designation permission matrix - so granting INVENTORY_REVIEW to a role via
// Designation access made GET /inventory/needs-spare-requests etc. work for them but left
// this live Need Spare review channel permanently rejecting the same user, exactly the gap
// the-fool's earlier pre-mortem flagged for ReportsGateway's identical shape. Fixed the
// same way ReportsGateway's own handshake was: consulting the real source of truth. Here
// that's the newly-extracted RolePermissionsService.userHasCapability() (rather than
// ReportsGateway's own inline roleHasCapability/getGrantedRoleNames/
// hasActiveAccessToAnyRole calls) - see that method's own doc comment for why it exists.
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

describe('InventoryGateway.handleConnection', () => {
  let gateway: InventoryGateway;
  let userRepoFindOne: jest.Mock;
  let jwtVerifyAsync: jest.Mock;
  let userHasCapability: jest.Mock;
  let getPendingNeedSpareRequests: jest.Mock;

  beforeEach(async () => {
    userRepoFindOne = jest.fn();
    jwtVerifyAsync = jest.fn().mockResolvedValue({ sub: 'user-1' });
    userHasCapability = jest.fn();
    getPendingNeedSpareRequests = jest.fn().mockResolvedValue([]);

    const module = await Test.createTestingModule({
      providers: [
        InventoryGateway,
        { provide: InventoryService, useValue: { getPendingNeedSpareRequests } },
        { provide: JwtService, useValue: { verifyAsync: jwtVerifyAsync } },
        { provide: ConfigService, useValue: { get: () => 'test-secret' } },
        { provide: getRepositoryToken(User), useValue: { findOne: userRepoFindOne } },
        { provide: RolePermissionsService, useValue: { userHasCapability } },
      ],
    }).compile();

    gateway = module.get(InventoryGateway);
    (gateway as any).logger = { warn: jest.fn(), error: jest.fn() };
  });

  it('admits a role granted INVENTORY_REVIEW (directly or via Designation access - userHasCapability decides), joining the reviewers room and sending an immediate snapshot', async () => {
    const user = buildUser({ roleName: RoleName.TECHNICAL_TEAM_LEADER, roleId: 'role-tl' });
    userRepoFindOne.mockResolvedValue(user);
    userHasCapability.mockResolvedValue(true);
    getPendingNeedSpareRequests.mockResolvedValue([{ id: 'req-1' }]);
    const socket = buildSocket();

    await gateway.handleConnection(socket);

    expect(userHasCapability).toHaveBeenCalledWith(user, 'INVENTORY_REVIEW');
    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(socket.join).toHaveBeenCalledWith('need-spare-reviewers');
    expect(socket.emit).toHaveBeenCalledWith('need-spare:update', [{ id: 'req-1' }]);
    expect(socket.data.userId).toBe('user-1');
  });

  it("this channel now moving off a hardcoded role list is the whole point - a role WITHOUT the default TECHNICAL_TEAM_LEADER membership still gets in once userHasCapability says yes (a Designation-access grant, from userHasCapability's perspective)", async () => {
    const user = buildUser({ roleName: RoleName.CCE, roleId: 'role-cce' });
    userRepoFindOne.mockResolvedValue(user);
    userHasCapability.mockResolvedValue(true);
    const socket = buildSocket();

    await gateway.handleConnection(socket);

    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(socket.join).toHaveBeenCalledWith('need-spare-reviewers');
  });

  it('rejects a role userHasCapability says lacks the capability (no direct grant, no delegated access, no bypass)', async () => {
    const user = buildUser({ roleName: RoleName.CCE, roleId: 'role-cce' });
    userRepoFindOne.mockResolvedValue(user);
    userHasCapability.mockResolvedValue(false);
    const socket = buildSocket();

    await gateway.handleConnection(socket);

    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Unauthorized' });
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('rejects (fails closed) when the capability lookup itself rejects, rather than silently admitting', async () => {
    const user = buildUser({ roleName: RoleName.CCE, roleId: 'role-cce' });
    userRepoFindOne.mockResolvedValue(user);
    userHasCapability.mockRejectedValue(new Error('DB down'));
    const socket = buildSocket();

    await gateway.handleConnection(socket);

    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('still rejects an inactive user before the capability is even considered', async () => {
    userRepoFindOne.mockResolvedValue(buildUser({ status: UserStatus.SUSPENDED }));
    const socket = buildSocket();

    await gateway.handleConnection(socket);

    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(userHasCapability).not.toHaveBeenCalled();
  });

  it('rejects when no token is present on the handshake at all', async () => {
    userRepoFindOne.mockResolvedValue(buildUser());
    const socket = buildSocket();
    socket.handshake.auth = {};

    await gateway.handleConnection(socket);

    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(jwtVerifyAsync).not.toHaveBeenCalled();
  });
});
