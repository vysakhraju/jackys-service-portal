import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CREATABLE_ROLE_NAMES } from './create-user.dto';

// Email is deliberately NOT editable here - it's the user's login identity, and changing
// it deserves its own careful flow (re-verification, session invalidation) rather than
// being bundled into a general profile-edit form. Not in this round's scope.
export class UpdateUserDto {
  @ApiProperty({ required: false, example: 'Jane' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName?: string;

  @ApiProperty({ required: false, example: 'Doe' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName?: string;

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

  @ApiProperty({ required: false, enum: CREATABLE_ROLE_NAMES })
  @IsOptional()
  @IsIn(CREATABLE_ROLE_NAMES)
  roleName?: string;
}
