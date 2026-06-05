import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export const TIPOS_MEDICAO = ['horimetro', 'hodometro'] as const;
export type TipoMedicao = (typeof TIPOS_MEDICAO)[number];

export class CreateAbastecimentoDto {
  @ApiProperty({ description: 'Prefecture identifier (tenant).' })
  @IsString()
  @IsNotEmpty()
  prefeituraId!: string;

  @ApiProperty({ description: 'Placa ou chassi do equipamento.' })
  @IsString()
  @IsNotEmpty()
  plateOrChassis!: string;

  @ApiProperty({ description: 'Litros abastecidos. Deve ser maior que zero.' })
  @Type(() => Number)
  @IsNumber()
  @Min(0.000001)
  liters!: number;

  @ApiProperty({
    enum: TIPOS_MEDICAO,
    description: 'Tipo de medição informado no abastecimento.',
  })
  @IsIn(TIPOS_MEDICAO)
  measurementType!: TipoMedicao;

  @ApiProperty({
    description: 'Leitura atual do medidor (horímetro/hodômetro).',
  })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  currentReading!: number;

  @ApiPropertyOptional({
    description: 'Foto do medidor (URL, data URL ou referência no storage).',
  })
  @IsOptional()
  @IsString()
  meterPhoto?: string;

  @ApiProperty({ description: 'Latitude capturada automaticamente no app.' })
  @Type(() => Number)
  @IsNumber()
  latitude!: number;

  @ApiProperty({ description: 'Longitude capturada automaticamente no app.' })
  @Type(() => Number)
  @IsNumber()
  longitude!: number;
}
