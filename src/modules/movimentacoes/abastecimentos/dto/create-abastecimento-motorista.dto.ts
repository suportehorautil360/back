import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import { TIPOS_MEDICAO, type TipoMedicao } from './create-abastecimento.dto';

export class CreateAbastecimentoMotoristaDto {
  @ApiPropertyOptional({
    description:
      'UUID gerado no app antes do upload das fotos (idempotência e pasta no storage).',
  })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty({ description: 'Prefecture identifier (tenant).' })
  @IsString()
  @IsNotEmpty()
  prefeituraId!: string;

  @ApiProperty({ description: 'Id do funcionário (condutor) autenticado.' })
  @IsString()
  @IsNotEmpty()
  funcionarioId!: string;

  @ApiProperty({ description: 'Id do equipamento abastecido.' })
  @IsString()
  @IsNotEmpty()
  equipmentId!: string;

  @ApiProperty({
    description: 'Nome do posto avulso (não credenciado).',
    example: 'Posto Shell BR-101',
  })
  @IsString()
  @MinLength(2)
  postoNome!: string;

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

  @ApiProperty({
    description: 'Foto do medidor (URL pública ou data URL).',
  })
  @IsString()
  @IsNotEmpty()
  meterPhoto!: string;

  @ApiProperty({
    description: 'Foto do cupom fiscal (URL pública ou data URL).',
  })
  @IsString()
  @IsNotEmpty()
  receiptPhoto!: string;

  @ApiPropertyOptional({
    description: 'Preço por litro (R$).',
    example: 6.12,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  pricePerLiter?: number;

  @ApiProperty({
    description: 'Valor total do abastecimento (R$), informado pelo motorista.',
    example: 520.2,
  })
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  total!: number;

  @ApiProperty({ description: 'Latitude capturada no app.' })
  @Type(() => Number)
  @IsNumber()
  latitude!: number;

  @ApiProperty({ description: 'Longitude capturada no app.' })
  @Type(() => Number)
  @IsNumber()
  longitude!: number;
}
