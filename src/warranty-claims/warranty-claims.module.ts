import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WarrantyClaimsService } from './warranty-claims.service';
import { WarrantyClaimsController } from './warranty-claims.controller';
import { WarrantyClaim } from './entities/warranty-claim.entity';
import { WarrantyClaimLine } from './entities/warranty-claim-line.entity';
import { AuthModule } from '../auth/auth.module';
import { GlLedgerModule } from '../gl-ledger/gl-ledger.module';

@Module({
  imports: [
    // InventoryReservation is deliberately not registered here - WarrantyClaimsService
    // only ever reads it through the transaction manager inside aggregate() (it needs to
    // run inside that method's advisory-locked transaction, not via an injected
    // Repository), and the entity is already globally registered with the DataSource by
    // InventoryModule.
    TypeOrmModule.forFeature([WarrantyClaim, WarrantyClaimLine]),
    AuthModule,
    GlLedgerModule,
  ],
  controllers: [WarrantyClaimsController],
  providers: [WarrantyClaimsService],
  exports: [WarrantyClaimsService],
})
export class WarrantyClaimsModule {}
