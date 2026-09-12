import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * O brief da Task 9 referencia `EntradaDto` no controller (Step 6) mas não
 * lista este arquivo em "Files" nem dá o código dele — só o formato do corpo
 * (`{ pecaId, depositoId, quantidade, custoUnit?, observacao? }`, vindo da
 * seção de interfaces da tarefa).
 *
 * Decorators no molde de `mecanica/dto/` (ex.: `preventiva.dto.ts`,
 * `anexos.dto.ts`): sem eles, `POST /entradas` somava ao saldo físico
 * aceitando `quantidade` como string ou `NaN` — o guard do serviço
 * (`if (quantidade <= 0)`) nem pega `NaN`, porque QUALQUER comparação com
 * `NaN` é falsa. `maxDecimalPlaces` casa com a escala das colunas no banco:
 * `saldo_fisico` é `Decimal(12,3)`, `custo_unit` é `Decimal(12,4)`.
 */
export class EntradaDto {
  @ApiProperty({ description: 'Peça que está entrando no depósito.' })
  @IsUUID()
  pecaId!: string;

  @ApiProperty({ description: 'Depósito que recebe a peça.' })
  @IsUUID()
  depositoId!: string;

  @ApiProperty({ description: 'Quantidade que entra no físico. Tem de ser maior que zero.' })
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  quantidade!: number;

  @ApiPropertyOptional({
    description:
      'Custo unitário da nota. Ausente mantém o custo médio — é o caso da ' +
      'devolução de sobra, que volta sem nota.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  custoUnit?: number;

  @ApiPropertyOptional({ description: 'Observação livre do lançamento.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  observacao?: string;
}
