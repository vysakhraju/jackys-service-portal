import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class ReleaseReservationDto {
  @ApiProperty({ example: 'Job reassigned to another technician - releasing so the original technician is no longer blocked', required: false })
  @IsOptional()
  @IsString()
  notes?: string;
}
