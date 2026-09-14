import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { InventoryModule } from './inventory.module';
import { InventoryGateway } from './inventory.gateway';
import { InventoryController } from './inventory.controller';
import { InventoryStock } from './entities/inventory-stock.entity';
import { InventoryReservation } from './entities/inventory-reservation.entity';
import { SparePart } from '../master-data/entities/spare-part.entity';
import { User } from '../auth/entities/user.entity';
import { Role } from '../auth/entities/role.entity';
import { AuditLog } from '../auth/entities/audit-log.entity';
import { Appointment } from '../appointments/entities/appointment.entity';
import { JobCard } from '../job-cards/entities/job-card.entity';
import { RoleAccessGrant } from '../auth/entities/role-access-grant.entity';
import { RolePermission } from '../auth/entities/role-permission.entity';

// Regression guard, same class of bug as reports.module.wiring.spec.ts's own (2026-09-14
// finding): a provider's constructor dependencies are only checked when something actually
// asks Nest to instantiate it through the real DI container - a hand-mocked unit test (see
// inventory.gateway.spec.ts) stays green even if InventoryModule itself forgot to make
// RolePermissionsService resolvable for InventoryGateway. Added alongside InventoryGateway
// picking up that new constructor param (Group C, replacing the old hardcoded VIEW_ROLES
// list with a live designation-permission-matrix check via
// RolePermissionsService.userHasCapability()) - this compiles the real @Module() through
// Nest's DI container to prove the wiring, not just the logic, is correct.
// InventoryService injects the raw DataSource directly (@InjectDataSource(), for its own
// transactional writes) rather than only a Repository - never exercised by this wiring
// check, but still a constructor dependency Nest must be able to resolve to instantiate it
// at all. Nothing in this test's module tree provides DataSource otherwise (there's no
// TypeOrmModule.forRoot() here), and a plain provider on the root testing module isn't
// visible to InventoryModule (Nest's module encapsulation only flows through explicit
// imports/exports, not upward to whatever imports a module) - @Global() is what makes it
// reachable from anywhere in the graph regardless of import direction. Same pattern as
// job-card-journey.module.wiring.spec.ts's own MockDataSourceModule.
@Global()
@Module({
  providers: [{ provide: getDataSourceToken(), useValue: { transaction: jest.fn() } }],
  exports: [getDataSourceToken()],
})
class MockDataSourceModule {}

describe('InventoryModule wiring', () => {
  it('compiles standalone, proving InventoryGateway can resolve RolePermissionsService via AuthModule', async () => {
    const mockRepo = { find: jest.fn(), findOne: jest.fn(), count: jest.fn(), create: jest.fn(), save: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), MockDataSourceModule, InventoryModule],
    })
      .overrideProvider(getRepositoryToken(InventoryStock))
      .useValue(mockRepo)
      .overrideProvider(getRepositoryToken(InventoryReservation))
      .useValue(mockRepo)
      .overrideProvider(getRepositoryToken(SparePart))
      .useValue(mockRepo)
      .overrideProvider(getRepositoryToken(User))
      .useValue(mockRepo)
      .overrideProvider(getRepositoryToken(Role))
      .useValue(mockRepo)
      .overrideProvider(getRepositoryToken(AuditLog))
      .useValue(mockRepo)
      .overrideProvider(getRepositoryToken(Appointment))
      .useValue(mockRepo)
      .overrideProvider(getRepositoryToken(JobCard))
      .useValue(mockRepo)
      .overrideProvider(getRepositoryToken(RoleAccessGrant))
      .useValue(mockRepo)
      .overrideProvider(getRepositoryToken(RolePermission))
      .useValue(mockRepo)
      .overrideProvider(ConfigService)
      .useValue({ get: (key: string) => (key === 'JWT_ACCESS_EXPIRES_IN' ? '15m' : 'test-secret') })
      .compile();

    expect(moduleRef.get(InventoryGateway)).toBeInstanceOf(InventoryGateway);
    expect(moduleRef.get(InventoryController)).toBeInstanceOf(InventoryController);

    await moduleRef.close();
  });
});
