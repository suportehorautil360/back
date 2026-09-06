import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsLatitude,
  IsLongitude,
  IsInt,
  Min,
  IsNumber,
} from 'class-validator';

const TIPOS = ['entrada', 'almoco', 'volta', 'saida'] as const;

/** Payload do PWA operador — espelha `BaterPontoInput` do horautil. */
export class BaterPontoDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ description: 'Selfie em data URL base64' })
  @IsString()
  @IsNotEmpty()
  photo!: string;

  @ApiProperty({ description: 'legacyId Firestore ou UUID Postgres da empresa' })
  @IsString()
  @IsNotEmpty()
  prefeituraId!: string;

  @ApiProperty({ description: 'Horário da batida no dispositivo (ISO 8601)' })
  @IsString()
  @IsNotEmpty()
  timestampOriginal!: string;

  @ApiProperty({ enum: TIPOS })
  @IsIn(TIPOS)
  tipo!: (typeof TIPOS)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cpf?: string;

  @ApiPropertyOptional({
    description: 'Latitude da marcação. Fora da cadeia de hash; nunca impede a batida.',
  })
  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional({ description: 'Longitude da marcação.' })
  @IsOptional()
  @IsLongitude()
  longitude?: number;

  @ApiPropertyOptional({ description: 'Precisão informada pelo dispositivo, em metros.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  precisaoMetros?: number;
}
