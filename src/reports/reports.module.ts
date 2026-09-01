import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { ReportsGateway } from './reports.gateway';
import { FinanceReportsService } from './finance-reports.service';
import { FinanceReportsController } from './finance-reports.controller';
import { QualityReportsService } from './quality-reports.service';
import { QualityReportsController } from './quality-reports.controller';
import { OperationalReportsService } from './operational-reports.service';
import { OperationalReportsController } from './operational-reports.controller';
import { JobCard } from '../job-cards/entities/job-card.entity';
import { Delivery } from '../delivery/entities/delivery.entity';
import { Estimate } from '../estimates/entities/estimate.entity';
import { TechnicianVisit } from '../technician/entities/technician-visit.entity';
import { FaultSymptom } from '../master-data/entities/fault-symptom.entity';
import { User } from '../auth/entities/user.entity';
import { AuthModule } from '../auth/auth.module';
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

// Pure read/query module - no new tables. AuthModule is imported for JwtModule (the
// gateway verifies WebSocket handshake tokens itself, since JwtAuthGuard/RolesGuard are
// HTTP-context-only - see ReportsGateway's doc comment) and RolesGuard (REST endpoints).
//
// Backend Phase 13 (BRD 18.2/18.3/18.4 - Finance/Quality/Operational dashboards) lives in
// this same module, not a new one - same "pure read/query, no new tables" precedent as
// 18.1. See FinanceReportsService's class doc comment for the pre-mortem findings baked
// into its design (no blended revenue total, null-cascade discipline, etc).
@Module({
  imports: [
    TypeOrmModule.forFeature([
      JobCard,
      Delivery,
      Estimate,
      TechnicianVisit,
      FaultSymptom,
      User,
      Invoice,
      Payment,
      DebitNote,
      WarrantyClaim,
      AmcContract,
      AmcBillingInvoice,
      Appointment,
      ServiceCentre,
      InventoryReservation,
      SparePart,
    ]),
    AuthModule,
  ],
  controllers: [ReportsController, FinanceReportsController, QualityReportsController, OperationalReportsController],
  providers: [ReportsService, ReportsGateway, FinanceReportsService, QualityReportsService, OperationalReportsService],
  exports: [ReportsService, FinanceReportsService, QualityReportsService, OperationalReportsService],
})
export class ReportsModule {}
