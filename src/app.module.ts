import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { MasterDataModule } from './master-data/master-data.module';
import { AppointmentsModule } from './appointments/appointments.module';
import { TechnicianModule } from './technician/technician.module';
import { JobCardsModule } from './job-cards/job-cards.module';
import { EstimatesModule } from './estimates/estimates.module';
import { NotificationsModule } from './notifications/notifications.module';
import { WorkshopModule } from './workshop/workshop.module';
import { InventoryModule } from './inventory/inventory.module';
// import { DeliveryModule } from './delivery/delivery.module';
// import { FinanceModule } from './finance/finance.module';
// import { AmcModule } from './amc/amc.module';
// import { DismantlingModule } from './dismantling/dismantling.module';
// import { ReportsModule } from './reports/reports.module';
// import { CustomerPortalModule } from './customer-portal/customer-portal.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        type: 'postgres',
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        username: process.env.DB_USERNAME || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
        database: process.env.DB_NAME || 'jackys_service_portal',
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        synchronize: process.env.NODE_ENV !== 'production',
        logging: process.env.NODE_ENV === 'development',
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
      }),
    }),
    AuthModule,
    MasterDataModule,
    AppointmentsModule,
    TechnicianModule,
    JobCardsModule,
    EstimatesModule,
    NotificationsModule,
    InventoryModule,
    WorkshopModule,
    // DeliveryModule,
    // FinanceModule,
    // AmcModule,
    // DismantlingModule,
    // ReportsModule,
    // CustomerPortalModule,
  ],
})
export class AppModule {}