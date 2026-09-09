import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class AddCrewHelperDto {
  @ApiProperty({ example: '9f4b8e2a-1234-4a5b-9c6d-abcdef123456', description: 'Helper technician user id (must hold TECHNICIAN_WORKSHOP)' })
  @IsUUID()
  technicianId: string;
}
