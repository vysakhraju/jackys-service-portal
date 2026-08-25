import { ApiProperty } from '@nestjs/swagger';
import { IsArray, ArrayMinSize, ArrayUnique, IsUUID } from 'class-validator';

export class CreateDeliveryDto {
  // FR-11/AC-10: batch or normal (N=1) delivery, all under one generated DLV#. Every job
  // card listed here must be QC_PASSED and not already attached to another delivery -
  // enforced in DeliveryService.create() under a per-job-card advisory lock so two
  // dispatchers can never claim the same job into two different DLV#s.
  @ApiProperty({
    example: ['9f4b8e2a-1234-4a5b-9c6d-abcdef123456'],
    description: 'One or more Job Card ids to batch into a single delivery (a single id = a normal, non-batch delivery)',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  jobCardIds: string[];
}
