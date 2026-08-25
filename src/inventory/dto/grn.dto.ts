import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsInt, Min, IsOptional, IsString } from 'class-validator';

export class GrnDto {
  @ApiProperty({ example: '9f4b8e2a-1234-4a5b-9c6d-abcdef123456', description: 'The SparePart receiving new stock' })
  @IsUUID()
  sparePartId: string;

  @ApiProperty({ example: 50, description: 'Quantity received' })
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiProperty({ example: 'GRN against PO-2044, supplier delivery note attached', required: false })
  @IsOptional()
  @IsString()
  notes?: string;
}
