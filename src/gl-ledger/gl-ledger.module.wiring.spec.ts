import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GlLedgerModule } from './gl-ledger.module';
import { GlLedgerController } from './gl-ledger.controller';
import { GlPosting } from './entities/gl-posting.entity';
import { User } from '../auth/entities/user.entity';
import { Role } from '../auth/entities/role.entity';
import { AuditLog } from '../auth/entities/audit-log.entity';
import { RoleAccessGrant } from '../auth/entities/role-access-grant.entity';
import { RolePermission } from '../auth/entities/role-permission.entity';
import { Appointment } from '../appointments/entities/appointment.entity';
import { JobCard } from '../job-cards/entities/job-card.entity';
import { InventoryReservation } from '../inventory/entities/inventory-reservation.entity';

// Regression test for a real bug found 2026-09-08 while QA-reviewing an unrelated feature
// (job-card-journey.module.wiring.spec.ts): GlLedgerModule never imported AuthModule, so
// GlLedgerController's own @UseGuards(JwtAuthGuard, RolesGuard) could not resolve
// RolesGuard's RoleAccessService dependency. A guard referenced by class in @UseGuards()
// is instantiated using its CONTROLLER'S OWN host module as the DI context (not a global
// fallback across sibling modules, confirmed by reproducing this with GlLedgerModule +
// AuthModule as plain siblings in a bare TestingModule) - and route-level guards are only
// resolved lazily, on the first real request to that route, not eagerly at app bootstrap
// like constructor injection. That's exactly why this survived undetected: every GL Ledger
// endpoint would have 500'd with "Nest can't resolve dependencies of RolesGuard" on its
// very first real request, but nothing in this suite (nor, apparently, prior live testing)
// had ever actually issued one. Fixed by adding AuthModule to GlLedgerModule's imports;
// this test compiles the module for real through Nest's DI container (not `new` + manual
// mocks, which would stay green even with the bug present) so a regression here fails loud.
describe('GlLedgerModule wiring', () => {
  it('compiles standalone, proving GlLedgerController can resolve JwtAuthGuard/RolesGuard from its own module scope', async () => {
    const mockRepo = { find: jest.fn(), findOne: jest.fn(), count: jest.fn(), create: jest.fn(), save: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), GlLedgerModule],
    })
      .overrideProvider(getRepositoryToken(GlPosting))
      .useValue(mockRepo)
      .overrideProvider(getRepositoryToken(User))
      .useValue(mockRepo)
      .overrideProvider(getRepositoryToken(Role))
      .useValue(mockRepo)
      .overrideProvider(getRepositoryToken(AuditLog))
      .useValue(mockRepo)
      .overrideProvider(getRepositoryToken(RoleAccessGrant))
      .useValue(mockRepo)
      .overrideProvider(getRepositoryToken(RolePermission))
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

    expect(moduleRef.get(GlLedgerController)).toBeInstanceOf(GlLedgerController);

    await moduleRef.close();
  });
});
