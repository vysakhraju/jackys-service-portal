import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsArray, ValidateNested, IsString, IsNumber, Min, ArrayMinSize, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export class EstimateLineItemDto {
  @ApiProperty({ example: 'Drum Motor Assembly (Part)' })
  @IsString()
  @MaxLength(255)
  description: string;

  @ApiProperty({ example: 1 })
  @IsNumber()
  @Min(1)
  quantity: number;

  @ApiProperty({ example: 350.0 })
  @IsNumber()
  @Min(0)
  unitPrice: number;
}

export class CreateEstimateDto {
  @ApiProperty({ example: '3f1b2c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d', description: 'Job Card this estimate is for (must be OOW and SN_VALIDATED)' })
  @IsUUID()
  jobCardId: string;

  @ApiProperty({
    type: [EstimateLineItemDto],
    example: [
      { description: 'Drum Motor Assembly (Part)', quantity: 1, unitPrice: 350.0 },
      { description: 'Labor - Workshop repair', quantity: 1, unitPrice: 120.0 },
    ],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => EstimateLineItemDto)
  lineItems: EstimateLineItemDto[];
}
