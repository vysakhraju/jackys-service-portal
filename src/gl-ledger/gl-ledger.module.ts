import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GlPosting } from './entities/gl-posting.entity';
import { GlLedgerService } from './gl-ledger.service';
import { GlLedgerController } from './gl-ledger.controller';

@Module({
  imports: [TypeOrmModule.forFeature([GlPosting])],
  controllers: [GlLedgerController],
  providers: [GlLedgerService],
  exports: [GlLedgerService],
})
export class GlLedgerModule {}
