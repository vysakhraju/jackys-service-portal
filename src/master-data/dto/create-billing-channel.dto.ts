import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean, MaxLength } from 'class-validator';

export class CreateBillingChannelDto {
  @ApiProperty({ example: 'Corporate Interdepartment' })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateBillingChannelDto extends PartialType(CreateBillingChannelDto) {}
