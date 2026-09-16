import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean, MaxLength } from 'class-validator';

export class CreateApplianceModelDto {
  @ApiProperty({ example: 'Samsung' })
  @IsString()
  @MaxLength(100)
  brand: string;

  @ApiProperty({ example: 'RT28' })
  @IsString()
  @MaxLength(100)
  model: string;

  @ApiProperty({ required: false, example: '280L double-door refrigerator' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateApplianceModelDto extends PartialType(CreateApplianceModelDto) {}
