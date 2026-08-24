import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class AssignTechnicianDto {
  @ApiProperty({ example: '3f1b2c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d', description: 'User ID of the technician to assign' })
  @IsUUID()
  technicianId: string;
}
