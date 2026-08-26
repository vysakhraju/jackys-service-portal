import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DebitNotesService } from './debit-notes.service';
import { DebitNotesController } from './debit-notes.controller';
import { DebitNote } from './entities/debit-note.entity';
import { InventoryReservation } from '../inventory/entities/inventory-reservation.entity';
import { SparePart } from '../master-data/entities/spare-part.entity';
import { ServicePriceList } from '../master-data/entities/service-price-list.entity';
import { JobCardsModule } from '../job-cards/job-cards.module';
import { AuthModule } from '../auth/auth.module';
import { GlLedgerModule } from '../gl-ledger/gl-ledger.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([DebitNote, InventoryReservation, SparePart, ServicePriceList]),
    JobCardsModule,
    AuthModule,
    GlLedgerModule,
  ],
  controllers: [DebitNotesController],
  providers: [DebitNotesService],
  exports: [DebitNotesService],
})
export class DebitNotesModule {}
