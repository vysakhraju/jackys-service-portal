import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsInt, Min, IsString, MinLength, MaxLength } from 'class-validator';

export class NeedSpareDto {
  @ApiProperty({ example: '9f4b8e2a-1234-4a5b-9c6d-abcdef123456', description: 'The SparePart the technician needs' })
  @IsUUID()
  sparePartId: string;

  @ApiProperty({ example: 1, description: 'Quantity needed' })
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiProperty({
    example: 'a1b2c3d4-need-spare-tap-001',
    description:
      'Client-generated once per "Need Spare" tap (a fresh value each time, never derived from the part/job) - lets a retried offline-queue sync for the SAME tap return the original request instead of creating a duplicate or erroring. A second, intentional request for the same part needs its own fresh key.',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  idempotencyKey: string;
}
