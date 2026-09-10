import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class ReorderFieldScheduleDto {
  @ApiProperty({ example: '9f4b8e2a-1234-4a5b-9c6d-abcdef123456', description: 'Field technician whose day is being reordered' })
  @IsUUID()
  technicianId: string;

  @ApiProperty({
    example: ['b1...', 'c2...', 'a3...'],
    description:
      "This technician's entire current set of active-status appointments, in the new order a CCE drag produced. Must be exactly that set - no missing, extra, or foreign ids.",
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID(undefined, { each: true })
  orderedAppointmentIds: string[];
}
