import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GlPosting } from './entities/gl-posting.entity';
import { GlLedgerService } from './gl-ledger.service';
import { GlLedgerController } from './gl-ledger.controller';
// AuthModule is imported so RolesGuard (used via @UseGuards(JwtAuthGuard, RolesGuard) in
// GlLedgerController) can resolve its RoleAccessService dependency, added when Extra Role
// Access shipped (2026-09-03) - every other module using RolesGuard already imports this,
// this one was missed and crashed the app at boot (UnknownDependenciesException).
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([GlPosting]), AuthModule],
  controllers: [GlLedgerController],
  providers: [GlLedgerService],
  exports: [GlLedgerService],
})
export class GlLedgerModule {}
