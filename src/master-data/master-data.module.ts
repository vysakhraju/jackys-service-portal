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