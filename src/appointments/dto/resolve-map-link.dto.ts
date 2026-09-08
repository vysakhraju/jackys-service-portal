import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResolveMapLinkDto {
  @ApiProperty({ example: 'https://maps.app.goo.gl/AbCdEfGhIjKlMnOp' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  url: string;
}
