import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

// Deliberately the only editable property - fieldKey/fieldLabel are fixed by the seed
// script (see appointment-field-config.entity.ts's own doc comment for why).
export class UpdateAppointmentFieldConfigDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  isMandatory: boolean;
}
