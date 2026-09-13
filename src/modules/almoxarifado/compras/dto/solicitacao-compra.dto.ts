import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsNumber,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

/**
 * A prioridade que uma pessoa escolhe numa solicitação manual. `reposicao` é
 * da automática por estoque mínimo — não se escolhe à mão.
 */
export const PRIORIDADES_MANUAIS = ['critica', 'alta', 'normal'] as const;

export class ItemDeSolicitacaoDto {
  @ApiProperty({ description: 'Peça a comprar.' })
  @IsUUID()
  pecaId!: string;

  // `quantidade` é `NUMERIC(12,3)` com CHECK `> 0`: três casas e o teto da
  // coluna aqui, para o erro voltar como 400 e não como 500 do Postgres.
  @ApiProperty({ description: 'Quanto comprar. Maior que zero, até 3 casas.' })
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  @Max(999_999_999.999)
  quantidade!: number;
}

export class CriarSolicitacaoDto {
  @ApiProperty({ description: 'Depósito que vai receber a peça.' })
  @IsUUID()
  depositoId!: string;

  @ApiProperty({ enum: PRIORIDADES_MANUAIS })
  @IsIn([...PRIORIDADES_MANUAIS])
  prioridade!: string;

  @ApiProperty({ description: 'Para que a peça é — sem OS, é o único contexto que Compras terá.' })
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  justificativa!: string;

  // "Sem `pecaId` repetido" é conferido no serviço: `@ArrayUnique` com
  // identificador chamaria `item.pecaId` num elemento que pode nem ser objeto.
  @ApiProperty({ type: [ItemDeSolicitacaoDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ItemDeSolicitacaoDto)
  itens!: ItemDeSolicitacaoDto[];
}
