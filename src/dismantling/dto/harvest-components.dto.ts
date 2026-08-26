import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsEnum, IsInt, IsString, Min, ValidateNested } from 'class-validator';
import { HarvestedComponentCondition } from '../entities/dismantling-record.entity';

export class HarvestComponentItemDto {
  @ApiProperty({ example: 'COMP-COMPRESSOR-01', description: 'Must match a ComponentYieldMatrix.originalBomItemCode for this record\'s modelId to be eligible for conversion later' })
  @IsString()
  originalBomItemCode: string;

  @ApiProperty({ enum: HarvestedComponentCondition, example: HarvestedComponentCondition.GOOD_WORKING })
  @IsEnum(HarvestedComponentCondition)
  testedCondition: HarvestedComponentCondition;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  quantity: number;
}

export class HarvestComponentsDto {
  @ApiProperty({ type: [HarvestComponentItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => HarvestComponentItemDto)
  components: HarvestComponentItemDto[];
}
