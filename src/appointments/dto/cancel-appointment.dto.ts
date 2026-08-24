import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength } from 'class-validator';

export class CancelAppointmentDto {
  @ApiProperty({ example: 'Customer requested reschedule to next week' })
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  reason: string;
}
