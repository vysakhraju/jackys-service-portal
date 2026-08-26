import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { ReportsGateway } from './reports.gateway';
import { JobCard } from '../job-cards/entities/job-card.entity';
import { Delivery } from '../delivery/entities/delivery.entity';
import { Estimate } from '../estimates/entities/estimate.entity';
import { TechnicianVisit } from '../technician/entities/technician-visit.entity';
import { FaultSymptom } from '../master-data/entities/fault-symptom.entity';
import { User } from '../auth/entities/user.entity';
import { AuthModule } from '../auth/auth.module';

// Pure read/query module - no new tables. AuthModule is imported for JwtModule (the
// gateway verifies WebSocket handshake tokens itself, since JwtAuthGuard/RolesGuard are
// HTTP-context-only - see ReportsGateway's doc comment) and RolesGuard (REST endpoints).
@Module({
  imports: [
    TypeOrmModule.forFeature([JobCard, Delivery, Estimate, TechnicianVisit, FaultSymptom, User]),
    AuthModule,
  ],
  controllers: [ReportsController],
  providers: [ReportsService, ReportsGateway],
  exports: [ReportsService],
})
export class ReportsModule {}
