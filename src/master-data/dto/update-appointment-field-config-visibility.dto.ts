import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

// Job Type split (requested 2026-09-22), Phase 6 - separate endpoint/DTO from
// UpdateAppointmentFieldConfigDto (isMandatory) on purpose, so the existing Phase 2
// toggle-isMandatory call sites (and their tests) stay untouched. See
// appointment-field-config.entity.ts's own doc comment for why isVisible is a distinct
// concern from isMandatory.
export class UpdateAppointmentFieldConfigVisibilityDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  isVisible: boolean;
}
