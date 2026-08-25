import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class DispatchDeliveryDto {
  @ApiProperty({
    required: false,
    example: '9f4b8e2a-1234-4a5b-9c6d-abcdef123456',
    description: 'Who is physically driving this run - distinct from the dispatcher who created it. Optional at dispatch time.',
  })
  @IsOptional()
  @IsUUID()
  driverUserId?: string;
}
