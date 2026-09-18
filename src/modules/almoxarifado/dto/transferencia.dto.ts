import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class ItemParaTransferirDto {
  @ApiProperty({ description: 'Peça do catálogo.' })
  @IsUUID()
  pecaId!: string;

  // `quantidade` (de `transferencia_itens`) é `NUMERIC(12,3)`: três casas e o
  // teto da coluna aqui, para o erro voltar 400 e não 500 do Postgres —
  // mesmo raciocínio de `peca-adicional.dto.ts`/`devolucao.dto.ts`.
  @ApiProperty({ description: 'Quanto vai. Maior que zero, até 3 casas.' })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(999_999_999.999)
  quantidade!: number;
}

/** Monta o rascunho da transferência. */
export class CriarTransferenciaDto {
  @ApiProperty({ description: 'De onde a peça sai.' })
  @IsUUID()
  depositoOrigemId!: string;

  @ApiProperty({ description: 'Para onde vai. Tem de ser diferente da origem.' })
  @IsUUID()
  depositoDestinoId!: string;

  @ApiProperty({ description: 'As peças e quantidades.', type: [ItemParaTransferirDto] })
  @IsArray()
  @ArrayMinSize(1)
  // Teto de sanidade: transferência com mais de 200 linhas é mudança de
  // almoxarifado, não transferência — e o payload viraria problema de rede
  // antes de virar de regra.
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ItemParaTransferirDto)
  itens!: ItemParaTransferirDto[];

  @ApiProperty({ required: false, description: 'Por que a carga está indo.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  observacao?: string;
}

class ItemRecebidoDto {
  @ApiProperty({ description: 'Item da transferência.' })
  @IsUUID()
  itemId!: string;

  // `quantidadeRecebida` (de `transferencia_itens`) é `NUMERIC(12,3)`: três
  // casas e o teto da coluna aqui, mesmo raciocínio da quantidade acima.
  @ApiProperty({ description: 'Quanto chegou. Zero é resultado possível.' })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(999_999_999.999)
  quantidadeRecebida!: number;

  @ApiProperty({ required: false, description: 'Obrigatório quando chegou menos do que saiu.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  motivoDivergencia?: string;
}

/** Confirma o que chegou no destino. */
export class ReceberTransferenciaDto {
  @ApiProperty({ description: 'Um por item da transferência.', type: [ItemRecebidoDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ItemRecebidoDto)
  itens!: ItemRecebidoDto[];
}

/** Desiste do rascunho. */
export class CancelarTransferenciaDto {
  @ApiProperty({ description: 'Por que a transferência não vai mais. Obrigatório — CHECK no banco.' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  motivo!: string;
}
