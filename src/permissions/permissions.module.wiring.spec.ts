import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PermissionsModule } from './permissions.module';
import { PermissionsController } from './permissions.controller';
import { PermissionsService } from './permissions.service';
import { RoleCapabilitiesService } from './role-capabilities.service';
import { RoleAccessService } from '../auth/role-access.service';
import { RolesGuard } from '../auth/guards/roles.guard';
import { User } from '../auth/entities/user.entity';
import { Role } from '../auth/entities/role.entity';
import { AuditLog } from '../auth/entities/audit-log.entity';
import { RoleAccessGrant } from '../auth/entities/role-access-grant.entity';
import { UserPermissionGrant } from './entities/user-permission-grant.entity';
import { Appointment } from '../appointments/entities/appointment.entity';
import { JobCard } from '../job-cards/entities/job-card.entity';
import { InventoryReservation } from '../inventory/entities/inventory-reservation.entity';

// Not a behaviour test (those live in role-access.service.spec.ts / roles.guard.spec.ts /
// role-capabilities.service.spec.ts) - this exists purely to prove the module WIRING
// itself is correct: that AuthModule really does export RoleAccessService for
// PermissionsModule to inject, that DiscoveryModule is really available for
// RoleCapabilitiesService, and that nothing here regressed into a circular or missing
// dependency. Unit tests construct services with `new` + manual mocks, which would stay
// green even if the actual @Module() wiring were broken - this is what catches that class
// of mistake before it reaches the real app on the user's machine (2026-09-03, added
// alongside the "extra role access" feature since this is the first time RolesGuard - used
// via @UseGuards() in nearly every controller in the app - gained a new constructor
// dependency).
describe('PermissionsModule wiring', () => {
  it('compiles with AuthModule + DiscoveryModule providing everything RolesGuard/PermissionsController need', async () => {
    const mockRepo = { find: jest.fn(), findOne: jest.fn(), count: jest.fn(), create: jest.fn(), save: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), PermissionsModule],
    })
      .overrideProvider(getRepositoryToken(User))
      .useValue(mockRepo)
      .overrideProvider(getRepositoryToken(Role))
      .useValue(mockRepo)
      .overrideProvider(getRepositoryToken(AuditLog))
      .useValue(mockRepo)
      .overrideProvider(getRepositoryToken(RoleAccessGrant))
      .useValue(mockRepo)
      .overrideProvider(getRepositoryToken(UserPermissionGrant))
      .useValue(mockRepo)
      .overrideProvider(getRepositoryToken(Appointment))
      .useValue(mockRepo)
      .overrideProvider(getRepositoryToken(JobCard))
      .useValue(mockRepo)
      .overrideProvider(getRepositoryToken(InventoryReservation))
      .useValue(mockRepo)
      .overrideProvider(ConfigService)
      .useValue({ get: (key: string) => (key === 'JWT_ACCESS_EXPIRES_IN' ? '15m' : 'test-secret') })
      .compile();

    expect(moduleRef.get(PermissionsController)).toBeInstanceOf(PermissionsController);
    expect(moduleRef.get(PermissionsService)).toBeInstanceOf(PermissionsService);
    expect(moduleRef.get(RoleCapabilitiesService)).toBeInstanceOf(RoleCapabilitiesService);
    // Resolved from AuthModule via PermissionsModule's import of it - proves the export
    // chain actually works, not just that the class is constructable in isolation.
    expect(moduleRef.get(RoleAccessService)).toBeInstanceOf(RoleAccessService);
    expect(moduleRef.get(RolesGuard)).toBeInstanceOf(RolesGuard);

    await moduleRef.close();
  });
});
