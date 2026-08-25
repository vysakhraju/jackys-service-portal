import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';
import { InventoryStock } from './entities/inventory-stock.entity';
import { InventoryReservation } from './entities/inventory-reservation.entity';
import { SparePart } from '../master-data/entities/spare-part.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    // SparePart is registered directly here (not by importing MasterDataModule) purely
    // for the AC-17 "linked to a model" existence check in grn() - avoids a module
    // dependency for what's really just an entity relation.
    TypeOrmModule.forFeature([InventoryStock, InventoryReservation, SparePart]),
    // Needed because InventoryController's @UseInterceptors(AuditInterceptor) resolves
    // AuditInterceptor -> AuthService, which AuthModule provides/exports.
    AuthModule,
  ],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
