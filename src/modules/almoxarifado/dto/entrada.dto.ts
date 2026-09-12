import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * O brief da Task 9 referencia `EntradaDto` no controller (Step 6) mas não
 * lista este arquivo em "Files" nem dá o código dele — só o formato do corpo
 * (`{ pecaId, depositoId, quantidade, custoUnit?, observacao? }`, vindo da
 * seção de interfaces da tarefa). Molde igual ao de `ReservarDto`.
 */
export class EntradaDto {
  @ApiProperty({ description: 'Peça que está entrando no depósito.' })
  pecaId!: string;

  @ApiProperty({ description: 'Depósito que recebe a peça.' })
  depositoId!: string;

  @ApiProperty({ description: 'Quantidade que entra no físico. Tem de ser maior que zero.' })
  quantidade!: number;

  @ApiPropertyOptional({
    description:
      'Custo unitário da nota. Ausente mantém o custo médio — é o caso da ' +
      'devolução de sobra, que volta sem nota.',
  })
  custoUnit?: number;

  @ApiPropertyOptional({ description: 'Observação livre do lançamento.' })
  observacao?: string;
}
