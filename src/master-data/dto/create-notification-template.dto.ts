import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, IsOptional, IsArray, IsBoolean, MaxLength } from 'class-validator';
import { NotificationTrigger, NotificationChannel } from '../entities/notification-template.entity';

export class CreateNotificationTemplateDto {
  @ApiProperty({ enum: NotificationTrigger })
  @IsEnum(NotificationTrigger)
  trigger: NotificationTrigger;

  @ApiProperty({ enum: NotificationChannel })
  @IsEnum(NotificationChannel)
  channel: NotificationChannel;

  @ApiProperty({ example: 'Your technician is on the way' })
  @IsString()
  @MaxLength(255)
  subject: string;

  @ApiProperty({ example: 'Hi {{customerName}}, your technician {{technicianName}} is en route.' })
  @IsString()
  body: string;

  @ApiProperty({ required: false, type: [String], example: ['customerName', 'technicianName'] })
  @IsOptional()
  @IsArray()
  placeholders?: string[];

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
