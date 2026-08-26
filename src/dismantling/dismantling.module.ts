import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DismantlingService } from './dismantling.service';
import { DismantlingController } from './dismantling.controller';
import { DismantlingRecord } from './entities/dismantling-record.entity';
import { ComponentYieldMatrix } from '../master-data/entities/component-yield-matrix.entity';
import { SparePart } from '../master-data/entities/spare-part.entity';
import { InventoryStock } from '../inventory/entities/inventory-stock.entity';
import { AuthModule } from '../auth/auth.module';
import { GlLedgerModule } from '../gl-ledger/gl-ledger.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([DismantlingRecord, ComponentYieldMatrix, SparePart, InventoryStock]),
    AuthModule,
    GlLedgerModule,
  ],
  controllers: [DismantlingController],
  providers: [DismantlingService],
  exports: [DismantlingService],
})
export class DismantlingModule {}
