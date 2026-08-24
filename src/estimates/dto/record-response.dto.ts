import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsString, MinLength, MaxLength } from 'class-validator';
import { ContactMethod } from '../entities/estimate.entity';

export class RecordResponseDto {
  @ApiProperty({ example: true, description: 'true to record an approval, false to record a rejection' })
  @IsBoolean()
  approved: boolean;

  @ApiProperty({ enum: ContactMethod, example: ContactMethod.PHONE_CALL })
  @IsEnum(ContactMethod)
  contactMethod: ContactMethod;

  @ApiProperty({
    example: '+971501112222',
    description: 'The phone number or email actually used to reach the customer - must match what is on file for the appointment (anti-consent-laundering check)',
  })
  @IsString()
  @MaxLength(255)
  contactValue: string;

  @ApiProperty({ example: 'Called customer, confirmed total AED 470, approved to proceed with workshop repair' })
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  notes: string;
}
