import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class CriarOrdemDto {
  @ApiProperty({ description: 'O fornecedor: parceiro FORNECEDOR ativo da empresa.' })
  @IsUUID()
  partnerId!: string;

  @ApiProperty({ description: 'Depósito que recebe a compra. Todo item da ordem é dele.' })
  @IsUUID()
  depositoId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  condicaoPagamento?: string;

  // `strict` recusa data que não existe no calendário ("2026-02-30"): sem ele,
  // a string passa e `new Date` vira `Invalid Date` dentro do serviço.
  @ApiPropertyOptional({ description: 'Data ISO (AAAA-MM-DD).' })
  @IsOptional()
  @IsDateString({ strict: true })
  previsaoEntrega?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  observacao?: string;
}

/**
 * Campo ausente = não mexer; `null` explícito = apagar (só nos campos que a
 * coluna aceita nulos). `partnerId` não aceita `null` — a coluna é NOT NULL —
 * e por isso usa `ValidateIf` em vez de `IsOptional`, que deixaria o `null`
 * passar sem validação.
 */
export class EditarOrdemDto {
  @ApiPropertyOptional()
  @ValidateIf((o: EditarOrdemDto) => o.partnerId !== undefined)
  @IsUUID()
  partnerId?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  condicaoPagamento?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Data ISO (AAAA-MM-DD).' })
  @IsOptional()
  @IsDateString({ strict: true })
  previsaoEntrega?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  observacao?: string | null;
}

export class OrigemDaCotacaoDto {
  @ApiProperty({ description: 'Item de solicitação de compra que esta parte atende.' })
  @IsUUID()
  solicitacaoCompraItemId!: string;

  @ApiProperty({ description: 'Quanto desta linha vai para aquele item. Maior que zero, até 3 casas.' })
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  @Max(999_999_999.999)
  quantidade!: number;
}

export class ItemDaCotacaoDto {
  @ApiProperty()
  @IsUUID()
  pecaId!: string;

  // `valor_unit` é `NUMERIC(12,4)` com CHECK `>= 0`.
  @ApiProperty({ description: 'Preço unitário cotado. Zero ou mais, até 4 casas.' })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(99_999_999.9999)
  valorUnit!: number;

  // Sem origem a linha nasceria com quantidade zero, e o CHECK
  // `oc_item_quantidade_positiva` a recusaria com 500.
  @ApiProperty({ type: [OrigemDaCotacaoDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => OrigemDaCotacaoDto)
  origens!: OrigemDaCotacaoDto[];
}

export class SubstituirItensDto {
  // Lista vazia é válida: limpa o rascunho.
  @ApiProperty({ type: [ItemDaCotacaoDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ItemDaCotacaoDto)
  itens!: ItemDaCotacaoDto[];
}
