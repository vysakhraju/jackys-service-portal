import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';
import { InventoryGateway } from './inventory.gateway';
import { InventoryStock } from './entities/inventory-stock.entity';
import { InventoryReservation } from './entities/inventory-reservation.entity';
import { SparePart } from '../master-data/entities/spare-part.entity';
import { User } from '../auth/entities/user.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    // SparePart is registered directly here (not by importing MasterDataModule) purely
    // for the AC-17 "linked to a model" existence check in grn() - avoids a module
    // dependency for what's really just an entity relation. User is registered here too,
    // for InventoryGateway's own handshake-auth lookup - same reason ReportsModule
    // registers User directly rather than importing AuthModule's own User provider (a
    // WS gateway can't reuse JwtAuthGuard, so it looks the user up itself - see the
    // gateway's doc comment).
    TypeOrmModule.forFeature([InventoryStock, InventoryReservation, SparePart, User]),
    // Needed because InventoryController's @UseInterceptors(AuditInterceptor) resolves
    // AuditInterceptor -> AuthService, which AuthModule provides/exports - and because
    // InventoryGateway injects JwtService, which AuthModule exports via JwtModule.
    AuthModule,
  ],
  controllers: [InventoryController],
  providers: [InventoryService, InventoryGateway],
  exports: [InventoryService],
})
export class InventoryModule {}
