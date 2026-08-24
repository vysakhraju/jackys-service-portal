import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsObject, MaxLength } from 'class-validator';

export class CreateSparePartModelDto {
  @ApiProperty({ example: 'WA80J5710' })
  @IsString()
  @MaxLength(50)
  modelId: string;

  @ApiProperty({ example: 'Samsung' })
  @IsString()
  @MaxLength(100)
  brand: string;

  @ApiProperty({ example: 'Front Load Washer 8kg' })
  @IsString()
  @MaxLength(100)
  modelName: string;

  @ApiProperty({ required: false, type: Object })
  @IsOptional()
  @IsObject()
  attributes?: Record<string, any>;
}
