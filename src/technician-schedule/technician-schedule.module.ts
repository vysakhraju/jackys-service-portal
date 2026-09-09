import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TechnicianScheduleService } from './technician-schedule.service';
import { TechnicianScheduleController } from './technician-schedule.controller';
import { User } from '../auth/entities/user.entity';
import { AppointmentsModule } from '../appointments/appointments.module';
import { JobCardsModule } from '../job-cards/job-cards.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    AppointmentsModule,
    JobCardsModule,
    // JwtAuthGuard resolution, same convention as JobCardJourneyModule/JobCardsModule.
    AuthModule,
  ],
  controllers: [TechnicianScheduleController],
  providers: [TechnicianScheduleService],
})
export class TechnicianScheduleModule {}
