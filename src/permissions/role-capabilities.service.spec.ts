import { Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { MetadataScanner } from '@nestjs/core';
import { RoleCapabilitiesService } from './role-capabilities.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequiresPermissionGrant } from './decorators/requires-permission-grant.decorator';
import { PermissionType } from './entities/user-permission-grant.entity';
import { RoleName } from '../auth/entities/role.entity';

// Real decorators, real reflection - proves the service actually reads the same
// @Roles()/@ApiOperation/route metadata every controller in the app already carries,
// not a mocked stand-in for it. This is the point of the-fool's "always accurate,
// never drifts" claim about this endpoint - worth proving against real decorators.
@ApiTags('widgets')
@Controller('widgets')
class FakeWidgetsController {
  @Get(':id')
  @Roles('TECHNICAL_TEAM_LEADER', 'CCE')
  @ApiOperation({ summary: 'Get a widget' })
  getOne() {}

  @Post(':id/qc/approve')
  @Roles('TECHNICAL_TEAM_LEADER', 'QC_OFFICER')
  @RequiresPermissionGrant(PermissionType.QC_APPROVAL)
  @ApiOperation({ summary: 'QC-approve a widget' })
  qcApprove() {}

  @Get('unrestricted')
  listAll() {}
}

describe('RoleCapabilitiesService', () => {
  let service: RoleCapabilitiesService;
  let discoveryService: any;

  beforeEach(() => {
    const instance = new FakeWidgetsController();
    discoveryService = {
      getControllers: jest.fn().mockReturnValue([{ instance, metatype: FakeWidgetsController }]),
    };
    service = new RoleCapabilitiesService(discoveryService, new MetadataScanner());
  });

  it("includes an endpoint whose @Roles() list contains the requested role", () => {
    const result = service.getCapabilitiesForRole(RoleName.TECHNICAL_TEAM_LEADER);
    const widgets = result.find((m) => m.module === 'widgets');
    expect(widgets).toBeDefined();
    expect(widgets!.endpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: 'GET', path: '/widgets/:id', summary: 'Get a widget' }),
      ]),
    );
  });

  it('excludes an endpoint whose @Roles() list does not contain the requested role', () => {
    const result = service.getCapabilitiesForRole(RoleName.FINANCE_MANAGER);
    expect(result.find((m) => m.module === 'widgets')).toBeUndefined();
  });

  it('excludes routes with no @Roles() at all (not a role-distinguishing capability)', () => {
    const result = service.getCapabilitiesForRole(RoleName.TECHNICAL_TEAM_LEADER);
    const widgets = result.find((m) => m.module === 'widgets');
    expect(widgets!.endpoints.some((e) => e.path === '/widgets/unrestricted')).toBe(false);
  });

  it("flags an endpoint gated by a separate permission grant, instead of listing it as plainly included (the-fool finding #3)", () => {
    const result = service.getCapabilitiesForRole(RoleName.QC_OFFICER);
    const widgets = result.find((m) => m.module === 'widgets');
    const qcEndpoint = widgets!.endpoints.find((e) => e.path === '/widgets/:id/qc/approve');
    expect(qcEndpoint).toBeDefined();
    expect(qcEndpoint!.requiresSeparatePermissionGrant).toBe(PermissionType.QC_APPROVAL);
  });

  it('does not flag an ordinary endpoint as requiring a separate permission grant', () => {
    const result = service.getCapabilitiesForRole(RoleName.TECHNICAL_TEAM_LEADER);
    const widgets = result.find((m) => m.module === 'widgets');
    const getEndpoint = widgets!.endpoints.find((e) => e.path === '/widgets/:id' && e.method === 'GET');
    expect(getEndpoint!.requiresSeparatePermissionGrant).toBeNull();
  });

  it('returns an empty list for a role with no matching endpoints anywhere', () => {
    const result = service.getCapabilitiesForRole(RoleName.WARRANTY_CLERK);
    expect(result).toEqual([]);
  });
});
