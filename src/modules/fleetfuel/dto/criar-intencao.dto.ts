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

/**
 * Etapa 2 — operador confirma o abastecimento e gera o QR. Ainda NÃO debita
 * saldo; cria uma intenção `pendente_validacao` + token assinado.
 */
export class CriarIntencaoDto {
  @ApiProperty({ description: 'Prefeitura (tenant) do posto.' })
  @IsString()
  @IsNotEmpty()
  prefeituraId!: string;

  @ApiProperty({ description: 'Id do posto que está atendendo.' })
  @IsString()
  @IsNotEmpty()
  postoId!: string;

  @ApiPropertyOptional({ description: 'Nome do posto (para o comprovante).' })
  @IsOptional()
  @IsString()
  postoNome?: string;

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

  @ApiProperty({
    description: 'Tipo de combustível escolhido na bomba.',
    example: 'Diesel S-10',
  })
  @IsString()
  @IsNotEmpty()
  tipoCombustivel!: string;

  @ApiProperty({ description: 'Litros a abastecer.', example: 100 })
  @Type(() => Number)
  @IsNumber()
  @Min(0.000001)
  liters!: number;

  @ApiProperty({
    description: 'Preço por litro (R$) digitado pelo operador.',
    example: 6.12,
  })
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  pricePerLiter!: number;

  @ApiPropertyOptional({
    enum: TIPOS_MEDICAO,
    description: 'Tipo de medição. Padrão: hodometro (km).',
  })
  @IsOptional()
  @IsIn(TIPOS_MEDICAO)
  measurementType?: TipoMedicao;
}
