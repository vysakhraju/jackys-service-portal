import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class ValidateSnDto {
  @ApiProperty({ description: 'Does the captured serial number match the physical invoice?' })
  @IsBoolean()
  matches: boolean;

  @ApiProperty({ required: false, description: 'Notes, e.g. why it does not match' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
