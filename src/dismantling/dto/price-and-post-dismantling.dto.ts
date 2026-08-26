import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

export class PriceConversionItemDto {
  @ApiProperty({ example: 'COMP-COMPRESSOR-01', description: 'Must match an entry already logged at harvest time and eligible for conversion (GOOD_WORKING, category=RECOVERABLE_SPARE, has a convertedSparePartCode)' })
  @IsString()
  originalBomItemCode: string;

  @ApiProperty({ example: 85.0, description: 'Manual recovery unit price (AC-39) - not derived from any price list' })
  @IsNumber()
  @Min(0.01)
  recoveryUnitPrice: number;

  @ApiProperty({ required: false, example: 1, description: 'Defaults to the full harvested quantity for this component if omitted' })
  @IsOptional()
  @IsInt()
  @Min(1)
  quantityToConvert?: number;
}

export class PriceAndPostDismantlingDto {
  @ApiProperty({ type: [PriceConversionItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PriceConversionItemDto)
  conversions: PriceConversionItemDto[];
}
