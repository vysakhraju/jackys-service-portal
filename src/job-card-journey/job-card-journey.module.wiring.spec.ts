import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { JobCardJourneyModule } from './job-card-journey.module';
import { JobCardJourneyController } from './job-card-journey.controller';
import { JobCardJourneyService } from './job-card-journey.service';
import { JobCardsService } from '../job-cards/job-cards.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { TechnicianService } from '../technician/technician.service';
import { InventoryService } from '../inventory/inventory.service';
import { EstimatesService } from '../estimates/estimates.service';
import { InvoicingService } from '../invoicing/invoicing.service';
import { DeliveryService } from '../delivery/delivery.service';

import { JobCard } from '../job-cards/entities/job-card.entity';
import { JobCardTaskPause } from '../job-cards/entities/job-card-task-pause.entity';
import { JobCardCrewHelper } from '../job-cards/entities/job-card-crew-helper.entity';
import { Appointment } from '../appointments/entities/appointment.entity';
import { ServiceCentre } from '../master-data/entities/service-centre.entity';
import { User } from '../auth/entities/user.entity';
import { AuditLog } from '../auth/entities/audit-log.entity';
import { TechnicianVisit } from '../technician/entities/technician-visit.entity';
import { InventoryStock } from '../inventory/entities/inventory-stock.entity';
import { InventoryReservation } from '../inventory/entities/inventory-reservation.entity';
import { SparePart } from '../master-data/entities/spare-part.entity';
import { Estimate } from '../estimates/entities/estimate.entity';
import { Invoice } from '../invoicing/entities/invoice.entity';
import { Payment } from '../invoicing/entities/payment.entity';
import { Delivery } from '../delivery/entities/delivery.entity';
import { Role } from '../auth/entities/role.entity';
import { RoleAccessGrant } from '../auth/entities/role-access-grant.entity';
import { FaultSymptom } from '../master-data/entities/fault-symptom.entity';
import { SparePartModel } from '../master-data/entities/spare-part-model.entity';
import { ServicePriceList } from '../master-data/entities/service-price-list.entity';
import { TechnicianKpiRule } from '../master-data/entities/technician-kpi-rule.entity';
import { NotificationTemplate } from '../master-data/entities/notification-template.entity';
import { WarrantyMaster } from '../master-data/entities/warranty-master.entity';
import { ComponentYieldMatrix } from '../master-data/entities/component-yield-matrix.entity';
import { UserPermissionGrant } from '../permissions/entities/user-permission-grant.entity';
import { GlPosting } from '../gl-ledger/entities/gl-posting.entity';

// InventoryService and DeliveryService both inject the raw DataSource directly
// (@InjectDataSource(), for their own transactional writes) rather than only a
// Repository - never exercised by this read-only aggregator, but still a constructor
// dependency Nest must be able to resolve to instantiate them at all. Nothing in this
// test's module tree provides DataSource otherwise (there's no TypeOrmModule.forRoot()
// here), and a plain provider on the root testing module isn't visible to InventoryModule
// (Nest's module encapsulation only flows through explicit imports/exports, not upward to
// whatever imports a module) - @Global() is what makes it reachable from anywhere in the
// graph regardless of import direction.
@Global()
@Module({
  providers: [{ provide: getDataSourceToken(), useValue: { transaction: jest.fn() } }],
  exports: [getDataSourceToken()],
})
class MockDataSourceModule {}

// Not a behaviour test (those live in job-card-journey.service.spec.ts /
// job-card-journey.util.spec.ts) - this exists purely to prove the module WIRING itself is
// correct, the same reasoning as permissions.module.wiring.spec.ts. This module is a
// deliberately unusual case for this codebase: it's the first module to import SEVEN other
// feature modules at once (JobCards/Appointments/Technician/Inventory/Estimates/Invoicing/
// Delivery, transitively pulling in MasterData/Notifications/Auth too) specifically to sit
// "above" all of them without creating a cycle (see job-card-journey.service.ts's own doc
// comment). Unit tests construct JobCardJourneyService with `new` + manual mocks, which
// would stay green even if the real @Module() import graph were circular or missing an
// export - only actually compiling the module through Nest's DI container catches that.
describe('JobCardJourneyModule wiring', () => {
  it('compiles with every imported feature module providing everything the controller/service need', async () => {
    const mockRepo = { find: jest.fn(), findOne: jest.fn(), count: jest.fn(), create: jest.fn(), save: jest.fn() };
    const entities = [
      JobCard,
      JobCardTaskPause,
      // Added 2026-09-09 - JobCardsModule now also registers this for
      // JobCardsService.addCrewHelper()/removeCrewHelper()/listCrewHelpers() (the Gantt
      // board's "add crew helper" action), pulled in transitively the same way every
      // other JobCardsModule-registered entity here is.
      JobCardCrewHelper,
      Appointment,
      ServiceCentre,
      User,
      AuditLog,
      TechnicianVisit,
      InventoryStock,
      InventoryReservation,
      SparePart,
      Estimate,
      Invoice,
      Payment,
      Delivery,
      Role,
      RoleAccessGrant,
      FaultSymptom,
      SparePartModel,
      ServicePriceList,
      TechnicianKpiRule,
      NotificationTemplate,
      WarrantyMaster,
      ComponentYieldMatrix,
      // Not injected by anything in job-card-journey/ itself - pulled in transitively
      // because JobCardsModule imports PermissionsModule (for the QC-approval grant gate
      // on JobCardsController's own endpoints, unrelated to this aggregator).
      UserPermissionGrant,
      // Transitively via InvoicingModule -> GlLedgerModule (every recorded payment posts a
      // GL journal entry).
      GlPosting,
    ];

    let builder = Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), MockDataSourceModule, JobCardJourneyModule],
    });
    for (const entity of entities) {
      builder = builder.overrideProvider(getRepositoryToken(entity)).useValue(mockRepo);
    }
    const moduleRef = await builder
      .overrideProvider(ConfigService)
      .useValue({ get: (key: string) => (key === 'JWT_ACCESS_EXPIRES_IN' ? '15m' : 'test-secret') })
      .compile();

    expect(moduleRef.get(JobCardJourneyController)).toBeInstanceOf(JobCardJourneyController);
    expect(moduleRef.get(JobCardJourneyService)).toBeInstanceOf(JobCardJourneyService);
    // Resolved from each imported feature module - proves every export chain this
    // aggregator depends on actually works, not just that the classes are constructable
    // in isolation with hand-written mocks.
    expect(moduleRef.get(JobCardsService)).toBeInstanceOf(JobCardsService);
    expect(moduleRef.get(AppointmentsService)).toBeInstanceOf(AppointmentsService);
    expect(moduleRef.get(TechnicianService)).toBeInstanceOf(TechnicianService);
    expect(moduleRef.get(InventoryService)).toBeInstanceOf(InventoryService);
    expect(moduleRef.get(EstimatesService)).toBeInstanceOf(EstimatesService);
    expect(moduleRef.get(InvoicingService)).toBeInstanceOf(InvoicingService);
    expect(moduleRef.get(DeliveryService)).toBeInstanceOf(DeliveryService);

    await moduleRef.close();
  });
});
