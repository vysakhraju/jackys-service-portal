import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersController } from './users.controller';

// No separate UsersService/repository bindings - every method this controller calls
// (createUser, listUsers, listCreatableRoles, updateUser, reactivateUser) lives on
// AuthService, which already owns the User/Role repositories and the audit-logging
// helper. Keeping user lifecycle logic in one place (AuthService) rather than splitting
// it across two services was a deliberate choice, not an oversight - see auth.service.ts.
@Module({
  imports: [AuthModule],
  controllers: [UsersController],
})
export class UsersModule {}
