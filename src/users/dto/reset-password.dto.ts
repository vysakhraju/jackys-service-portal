import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

// Mirrors CreateUserDto's own password field (same 8-char minimum, same reasoning: an
// admin-set password is shared directly - WhatsApp, verbally, a note - and known to more
// than one person until the affected user changes it themselves via Change Password).
export class ResetPasswordDto {
  @ApiProperty({
    example: 'Welcome2026!',
    description:
      "New temporary password, set and shared by the admin directly - there's no email/invite-link " +
      'flow in this app, same as user creation. The affected user is signed out of any existing ' +
      'session immediately once this is set (see AuthService.resetPasswordByAdmin).',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(50)
  newPassword: string;
}
