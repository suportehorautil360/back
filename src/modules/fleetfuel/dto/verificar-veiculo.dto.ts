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
import { TIPOS_MEDICAO } from '../../movimentacoes/abastecimentos/dto/create-abastecimento.dto';
import type { TipoMedicao } from '../../movimentacoes/abastecimentos/dto/create-abastecimento.dto';

/** Etapa 1 — verificação do veículo + motorista antes de liberar o abastecimento. */
export class VerificarVeiculoDto {
  @ApiProperty({ description: 'Prefeitura (tenant) do posto.' })
  @IsString()
  @IsNotEmpty()
  prefeituraId!: string;

  @ApiProperty({ description: 'Id do posto que está atendendo.' })
  @IsString()
  @IsNotEmpty()
  postoId!: string;

  @ApiProperty({ description: 'Placa (ou chassi) do veículo.' })
  @IsString()
  @IsNotEmpty()
  placa!: string;

  @ApiProperty({
    description: 'KM atual lido no painel do veículo.',
    example: 130000,
  })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  kmAtual!: number;

  @ApiProperty({ description: 'CPF do motorista (com ou sem máscara).' })
  @IsString()
  @IsNotEmpty()
  cpfMotorista!: string;

  @ApiPropertyOptional({
    enum: TIPOS_MEDICAO,
    description: 'Tipo de medição. Padrão: hodometro (km).',
  })
  @IsOptional()
  @IsIn(TIPOS_MEDICAO)
  measurementType?: TipoMedicao;
}
