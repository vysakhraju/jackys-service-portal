import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GlPosting } from './entities/gl-posting.entity';
import { GlLedgerService } from './gl-ledger.service';
import { GlLedgerController } from './gl-ledger.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([GlPosting]),
    // GlLedgerController's own @UseGuards(JwtAuthGuard, RolesGuard) needs RolesGuard's
    // RoleAccessService dependency to be resolvable from THIS module's scope - a guard
    // referenced by class in @UseGuards() is instantiated using its controller's own host
    // module as the DI context, not a global fallback across sibling modules (confirmed by
    // reproducing this exact failure with GlLedgerModule + AuthModule as plain sibling
    // imports in a bare TestingModule). Route enhancers like this are only resolved lazily,
    // on the first request to that route - not eagerly at app bootstrap like constructor
    // injection - which is exactly why this was missing without ever surfacing: nothing in
    // this codebase's test suite or prior live-testing sessions had made a real HTTP
    // request to a GL Ledger endpoint yet. Found via the job-card-journey.module.wiring.spec
    // added in this session's QA pass (2026-09-08) - every GL Ledger endpoint would have
    // 500'd with "Nest can't resolve dependencies of RolesGuard" on its very first real
    // request.
    AuthModule,
  ],
  controllers: [GlLedgerController],
  providers: [GlLedgerService],
  exports: [GlLedgerService],
})
export class GlLedgerModule {}
