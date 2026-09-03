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

// Mirrors the REAL pattern used by ReportsController/FinanceReportsController/
// QualityReportsController/OperationalReportsController/UsersController - @Roles()
// applied once above the class, not repeated per method. Found missing 2026-09-03
// during an independent test-master pass: the service originally read ONLY
// Reflect.getMetadata(ROLES_KEY, handler) (method-level), so every endpoint in these 5
// real controllers was silently omitted from every role's capability preview - and
// TECHNICAL_TEAM_LEADER (a grantable role) is exactly who ReportsController's
// class-level @Roles() covers, so this hit the flagship "delegate TL access to a CCE"
// scenario directly, not just a theoretical edge case.
@ApiTags('gadgets')
@Controller('gadgets')
@Roles('TECHNICAL_TEAM_LEADER', 'SERVICE_HEAD')
class FakeGadgetsController {
  @Get()
  @ApiOperation({ summary: 'List gadgets' })
  listAll() {}

  @Post(':id/retire')
  // Method-level @Roles() here would override the class-level list per NestJS's own
  // getAllAndOverride semantics - proven by the 'method-level @Roles() overrides
  // class-level' test below.
  @Roles('SERVICE_HEAD')
  @ApiOperation({ summary: 'Retire a gadget' })
  retire() {}
}

describe('RoleCapabilitiesService', () => {
  let service: RoleCapabilitiesService;
  let discoveryService: any;

  beforeEach(() => {
    const widgets = new FakeWidgetsController();
    const gadgets = new FakeGadgetsController();
    discoveryService = {
      getControllers: jest.fn().mockReturnValue([
        { instance: widgets, metatype: FakeWidgetsController },
        { instance: gadgets, metatype: FakeGadgetsController },
      ]),
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

  it("includes every method of a controller gated by a CLASS-level @Roles() decorator (the real ReportsController/UsersController pattern) - regression for the 2026-09-03 test-master finding", () => {
    const result = service.getCapabilitiesForRole(RoleName.TECHNICAL_TEAM_LEADER);
    const gadgets = result.find((m) => m.module === 'gadgets');
    expect(gadgets).toBeDefined();
    expect(gadgets!.endpoints).toEqual(
      expect.arrayContaining([expect.objectContaining({ method: 'GET', path: '/gadgets' })]),
    );
  });

  it('excludes a class-gated controller entirely for a role not in the class-level @Roles() list', () => {
    const result = service.getCapabilitiesForRole(RoleName.CCE);
    expect(result.find((m) => m.module === 'gadgets')).toBeUndefined();
  });

  it("a method-level @Roles() overrides the class-level list for that one method (matches RolesGuard's getAllAndOverride semantics)", () => {
    // 'retire' is @Roles('SERVICE_HEAD') only, despite the class allowing
    // TECHNICAL_TEAM_LEADER too - TECHNICAL_TEAM_LEADER must not see it, SERVICE_HEAD must.
    const tlResult = service.getCapabilitiesForRole(RoleName.TECHNICAL_TEAM_LEADER);
    const tlGadgets = tlResult.find((m) => m.module === 'gadgets');
    expect(tlGadgets!.endpoints.some((e) => e.path === '/gadgets/:id/retire')).toBe(false);

    const shResult = service.getCapabilitiesForRole(RoleName.SERVICE_HEAD);
    const shGadgets = shResult.find((m) => m.module === 'gadgets');
    expect(shGadgets!.endpoints.some((e) => e.path === '/gadgets/:id/retire')).toBe(true);
  });
});
