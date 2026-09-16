import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean, MaxLength } from 'class-validator';

export class CreateCancellationReasonDto {
  @ApiProperty({ example: 'Customer not available' })
  @IsString()
  @MaxLength(150)
  label: string;

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCancellationReasonDto extends PartialType(CreateCancellationReasonDto) {}
