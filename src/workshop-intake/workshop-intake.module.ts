import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkshopIntakeService } from './workshop-intake.service';
import { WorkshopIntakeController } from './workshop-intake.controller';
import { WorkshopIntake } from './entities/workshop-intake.entity';
import { AppointmentsModule } from '../appointments/appointments.module';
import { MasterDataModule } from '../master-data/master-data.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([WorkshopIntake]),
    AppointmentsModule,
    MasterDataModule,
    // Needed because WorkshopIntakeController's @UseInterceptors(AuditInterceptor)
    // resolves AuditInterceptor -> AuthService, which AuthModule provides/exports.
    AuthModule,
  ],
  controllers: [WorkshopIntakeController],
  providers: [WorkshopIntakeService],
  // JobCardsModule imports this to read the intake record when creating a Job Card for a
  // COLLECTED_TO_WS appointment (see JobCardsService.create()'s new branch) - safe to
  // import directly, this module has no dependency back on JobCardsModule/TechnicianModule.
  exports: [WorkshopIntakeService],
})
export class WorkshopIntakeModule {}
