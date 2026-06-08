import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateLancamentoDto {
  @ApiProperty({ enum: ['receita', 'despesa'], example: 'receita' })
  tipo!: 'receita' | 'despesa';

  @ApiPropertyOptional({
    enum: ['pago', 'pendente', 'atrasado'],
    example: 'pendente',
  })
  status?: 'pago' | 'pendente' | 'atrasado';

  @ApiProperty({ example: 'Venda NF 4500' })
  descricao!: string;

  @ApiProperty({ example: 48500 })
  valor!: number;

  @ApiPropertyOptional({ example: '2026-06-10' })
  vencimento?: string;
}
