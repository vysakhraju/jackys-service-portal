import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TechnicianService } from './technician.service';
import { TechnicianController } from './technician.controller';
import { TechnicianVisit } from './entities/technician-visit.entity';
import { AppointmentsModule } from '../appointments/appointments.module';
import { MasterDataModule } from '../master-data/master-data.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TechnicianVisit]),
    AppointmentsModule,
    MasterDataModule,
    // Needed because TechnicianController's @UseInterceptors(AuditInterceptor) resolves
    // AuditInterceptor -> AuthService, which AuthModule provides/exports.
    AuthModule,
  ],
  controllers: [TechnicianController],
  providers: [TechnicianService],
  exports: [TechnicianService],
})
export class TechnicianModule {}
