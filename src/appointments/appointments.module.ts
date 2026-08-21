import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppointmentsService } from './appointments.service';
import { AppointmentsController } from './appointments.controller';
import { Appointment } from './entities/appointment.entity';
import { ServiceCentre } from '../master-data/entities/service-centre.entity';
import { User } from '../auth/entities/user.entity';
import { AuditLog } from '../auth/entities/audit-log.entity';
import { MasterDataModule } from '../master-data/master-data.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Appointment, ServiceCentre, User, AuditLog]),
    MasterDataModule,
    AuthModule,
  ],
  controllers: [AppointmentsController],
  providers: [AppointmentsService],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}