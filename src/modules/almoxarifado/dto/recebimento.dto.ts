import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** Uma linha da ordem de compra na conferência da entrega. */
export class ItemRecebidoDto {
  @ApiProperty({ description: 'Item da ordem de compra.' })
  @IsUUID()
  ordemCompraItemId!: string;

  @ApiProperty({ description: 'Quantidade que ENTROU no estoque.' })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  quantidadeRecebida!: number;

  @ApiPropertyOptional({
    description: 'Quantidade que veio e foi recusada. Não entra no estoque, não consome o pedido e exige divergência.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  quantidadeRecusada?: number;

  @ApiPropertyOptional({ description: 'Preço da nota, quando difere do da ordem de compra.' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  valorUnit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  lote?: string;

  @ApiPropertyOptional({ description: 'Data de validade (AAAA-MM-DD).' })
  @IsOptional()
  @IsDateString()
  validade?: string;

  @ApiPropertyOptional({ description: 'O que veio errado: peça trocada, avariada, a menos.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  divergencia?: string;
}

export class ReceberDto {
  @ApiProperty({ description: 'A ordem de compra que está sendo recebida.' })
  @IsUUID()
  ordemCompraId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  notaFiscalNumero?: string;

  @ApiPropertyOptional({ description: 'Chave de acesso da NF-e.' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  notaFiscalChave?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  observacao?: string;

  @ApiProperty({ type: [ItemRecebidoDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ItemRecebidoDto)
  itens!: ItemRecebidoDto[];
}
