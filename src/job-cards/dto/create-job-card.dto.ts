import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class CreateJobCardDto {
  @ApiProperty({ description: 'The Appointment this Job Card is created from' })
  @IsUUID()
  appointmentId: string;
}
