import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { MasterDataModule } from '../master-data/master-data.module';

@Module({
  imports: [MasterDataModule],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
