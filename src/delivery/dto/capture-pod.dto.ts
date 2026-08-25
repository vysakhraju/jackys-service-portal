import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

// Base64 inflates a decoded blob by ~4/3. Capping the encoded string at 2.8M chars caps
// the decoded payload at ~2MB - generous for a signature pad trace or a compressed phone
// photo, but small enough that a driver's app accidentally attaching a raw/uncompressed
// photo (or the wrong file entirely) fails fast with a clear 400 instead of silently
// bloating this text column (no blob storage exists yet - see the entity's doc comment).
const MAX_BASE64_CHARS = 2_800_000;

export class CapturePodDto {
  // AC-12: POD mandatory (signature OR photo) - at least one of these two must be
  // present, enforced in DeliveryService.capturePod() (a cross-field "at least one of"
  // rule isn't naturally expressible as a per-property class-validator decorator, so it's
  // checked once, explicitly, at the service layer instead).
  @ApiProperty({ required: false, description: 'Base64-encoded signature image (e.g. a signature-pad PNG data URI payload, without the data: prefix)' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_BASE64_CHARS)
  signatureBase64?: string;

  @ApiProperty({ required: false, description: 'Base64-encoded photo of the handed-back unit / recipient' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_BASE64_CHARS)
  photoBase64?: string;

  @ApiProperty({ example: 'Anita Kumar', description: 'Name of the person who received the unit' })
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  recipientName: string;

  @ApiProperty({ required: false, example: 'Handed over at reception, unit tested on-site before signing', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
