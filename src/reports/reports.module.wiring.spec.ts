import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ReportsModule } from './reports.module';
import { ReportsGateway } from './reports.gateway';
import { ReportsController } from './reports.controller';
import { JobCard } from '../job-cards/entities/job-card.entity';
import { JobCardTaskPause } from '../job-cards/entities/job-card-task-pause.entity';
import { Delivery } from '../delivery/entities/delivery.entity';
import { Estimate } from '../estimates/entities/estimate.entity';
import { TechnicianVisit } from '../technician/entities/technician-visit.entity';
import { FaultSymptom } from '../master-data/entities/fault-symptom.entity';
import { User } from '../auth/entities/user.entity';
import { Role } from '../auth/entities/role.entity';
import { AuditLog } from '../auth/entities/audit-log.entity';
import { RoleAccessGrant } from '../auth/entities/role-access-grant.entity';
import { RolePermission } from '../auth/entities/role-permission.entity';
import { Invoice } from '../invoicing/entities/invoice.entity';
import { Payment } from '../invoicing/entities/payment.entity';
import { DebitNote } from '../debit-notes/entities/debit-note.entity';
import { WarrantyClaim } from '../warranty-claims/entities/warranty-claim.entity';
import { AmcContract } from '../amc/entities/amc-contract.entity';
import { AmcBillingInvoice } from '../amc/entities/amc-billing-invoice.entity';
import { Appointment } from '../appointments/entities/appointment.entity';
import { ServiceCentre } from '../master-data/entities/service-centre.entity';
import { InventoryReservation } from '../inventory/entities/inventory-reservation.entity';
import { SparePart } from '../master-data/entities/spare-part.entity';

// Regression guard, same class of bug as gl-ledger.module.wiring.spec.ts's own (2026-09-08
// finding): a provider's constructor dependencies are only checked when something actually
// asks Nest to instantiate it through the real DI container - a hand-mocked unit test (see
// reports.gateway.spec.ts) stays green even if ReportsModule itself forgot to make
// RolePermissionsService/RoleAccessService resolvable for ReportsGateway. Added 2026-09-14
// alongside ReportsGateway picking up those two new constructor params (replacing the old
// hardcoded VIEW_ROLES list with a live designation-permission-matrix check) - this compiles
// the real @Module() through Nest's DI container to prove the wiring, not just the logic,
// is correct.
describe('ReportsModule wiring', () => {
  it('compiles standalone, proving ReportsGateway can resolve RolePermissionsService/RoleAccessService via AuthModule', async () => {
    const mockRepo = { find: jest.fn(), findOne: jest.fn(), count: jest.fn(), create: jest.fn(), save: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), ReportsModule],
    })
      .overrideProvider(getRepositoryToken(JobCard))
      .useValue(mockRepo)
      .overrideProvider(getRepositoryToken(JobCardTaskPause))
      .useValue(mockRepo)
      .overrideProvider(getRepositoryToken(Delivery))
      .useValue(mockRepo)
      .overrideProvider(getRepositoryToken(Estimate))
      .useValue(mockRepo)
      .overrideProvider(getRepositoryToken(TechnicianVisit))
      .useValue(mockRepo)
      .overrideProvider(getRepositoryToken(FaultSymptom))
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
      .overrideProvider(getRepositoryToken(Invoice))
      .useValue(mockRepo)
      .overrideProvider(getRepositoryToken(Payment))
      .useValue(mockRepo)
      .overrideProvider(getRepositoryToken(DebitNote))
      .useValue(mockRepo)
      .overrideProvider(getRepositoryToken(WarrantyClaim))
      .useValue(mockRepo)
      .overrideProvider(getRepositoryToken(AmcContract))
      .useValue(mockRepo)
      .overrideProvider(getRepositoryToken(AmcBillingInvoice))
      .useValue(mockRepo)
      .overrideProvider(getRepositoryToken(Appointment))
      .useValue(mockRepo)
      .overrideProvider(getRepositoryToken(ServiceCentre))
      .useValue(mockRepo)
      .overrideProvider(getRepositoryToken(InventoryReservation))
      .useValue(mockRepo)
      .overrideProvider(getRepositoryToken(SparePart))
      .useValue(mockRepo)
      .overrideProvider(ConfigService)
      .useValue({ get: (key: string) => (key === 'JWT_ACCESS_EXPIRES_IN' ? '15m' : 'test-secret') })
      .compile();

    expect(moduleRef.get(ReportsGateway)).toBeInstanceOf(ReportsGateway);
    expect(moduleRef.get(ReportsController)).toBeInstanceOf(ReportsController);

    await moduleRef.close();
  });
});
