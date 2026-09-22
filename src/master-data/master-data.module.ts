import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MasterDataService } from './master-data.service';
import { MasterDataController } from './master-data.controller';
import { ServiceCentre } from './entities/service-centre.entity';
import { FaultSymptom } from './entities/fault-symptom.entity';
import { SparePart } from './entities/spare-part.entity';
import { SparePartModel } from './entities/spare-part-model.entity';
import { ServicePriceList } from './entities/service-price-list.entity';
import { TechnicianKpiRule } from './entities/technician-kpi-rule.entity';
import { NotificationTemplate } from './entities/notification-template.entity';
import { WarrantyMaster } from './entities/warranty-master.entity';
import { ComponentYieldMatrix } from './entities/component-yield-matrix.entity';
import { City } from './entities/city.entity';
import { CancellationReason } from './entities/cancellation-reason.entity';
import { ApplianceModel } from './entities/appliance-model.entity';
import { BillingChannel } from './entities/billing-channel.entity';
import { AppointmentFieldConfig } from './entities/appointment-field-config.entity';
import { User } from '../auth/entities/user.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ServiceCentre,
      FaultSymptom,
      SparePart,
      SparePartModel,
      ServicePriceList,
      TechnicianKpiRule,
      NotificationTemplate,
      WarrantyMaster,
      ComponentYieldMatrix,
      // Appointment/Mobile/Job Card overhaul (2026-09-16) Phase 1 - new admin-manageable
      // masters backing the New Appointment popup (City, ApplianceModel) and the mobile
      // Cancellation action (CancellationReason). See
      // claude/APPOINTMENT_MOBILE_JOBCARD_SPEC.md for the full spec.
      City,
      CancellationReason,
      ApplianceModel,
      // Master-Data/New-Appointment billing modification (requested 2026-09-21) Phase 1 -
      // Billing Channel master (req. 4) and the mandatory-field config table (req. 1).
      BillingChannel,
      AppointmentFieldConfig,
      // #218/#253: listActiveFieldTechnicians() below backs the Service Centres page's
      // field-technician picker - CCE (who can create/update service centres) has no
      // access to GET /users (admin-only) or GET /technician-schedule/gantt (Team-Leader-
      // only), so this reads User directly rather than reusing either.
      User,
    ]),
    // Needed because MasterDataController's @UseInterceptors(AuditInterceptor) resolves
    // AuditInterceptor -> AuthService, which AuthModule provides/exports.
    AuthModule,
  ],
  controllers: [MasterDataController],
  providers: [MasterDataService],
  exports: [MasterDataService],
})
export class MasterDataModule {}