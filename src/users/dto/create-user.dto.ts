import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { RoleName } from '../../auth/entities/role.entity';

// CUSTOMER is deliberately excluded from the roles an admin can pick here - the-fool
// pre-mortem finding #3 (2026-09-03): customers reach this app through the no-login
// /track/:token portal (CustomerPortalPage.tsx), not a staff account, and there is no
// customer-facing login screen anywhere in the frontend. A CUSTOMER-role login created
// here would land the customer inside the internal staff console (ProtectedRoute doesn't
// restrict by role at the top level) with nothing they can actually do - a dead end, not
// a feature. The CUSTOMER enum value itself is untouched; it's just never offered here.
export const CREATABLE_ROLE_NAMES = Object.values(RoleName).filter((name) => name !== RoleName.CUSTOMER);

export class CreateUserDto {
  @ApiProperty({ example: 'Jane' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName: string;

  @ApiProperty({ example: 'jane.doe@jackys.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ required: false, example: 'EMP-0042' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  employeeId?: string;

  @ApiProperty({ required: false, example: '+971501234567' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiProperty({
    example: 'Welcome2026!',
    description:
      'Temporary password, set and shared by the admin directly (no email/invite-link flow exists in this app). ' +
      'Slightly stronger minimum than a regular password change (8 chars, not 6) since this one is often reused ' +
      'across new hires and known to more than one person until the user changes it themselves.',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(50)
  password: string;

  @ApiProperty({ enum: CREATABLE_ROLE_NAMES })
  @IsIn(CREATABLE_ROLE_NAMES)
  roleName: string;
}
