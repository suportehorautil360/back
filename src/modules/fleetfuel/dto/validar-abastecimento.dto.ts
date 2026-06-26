import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * Validação do abastecimento pelo motorista (pwa-motorista escaneia o QR). É
 * aqui que o saldo é efetivamente debitado e a intenção vira `concluido`.
 */
export class ValidarAbastecimentoDto {
  @ApiProperty({ description: 'Token assinado lido do QR.' })
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiPropertyOptional({
    description:
      'Id do funcionário (motorista) autenticado no app que está validando.',
  })
  @IsOptional()
  @IsString()
  funcionarioId?: string;

  @ApiPropertyOptional({
    description: 'CPF do motorista autenticado (alternativa ao funcionarioId).',
  })
  @IsOptional()
  @IsString()
  cpf?: string;
}
