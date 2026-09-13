import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/** Uma peça que o mecânico não usou e está devolvendo ao balcão. */
export class ItemDevolvidoDto {
  @ApiProperty({ description: 'Item da requisição que foi entregue.' })
  @IsUUID()
  itemId!: string;

  @ApiProperty({ description: 'Quanto volta. Maior que zero, até 3 casas, no máximo o que foi entregue.' })
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  @Max(999_999_999.999)
  quantidade!: number;
}

export class DevolverSobraDto {
  @ApiProperty({ description: 'Por que sobrou — fica no razão e na auditoria.' })
  @IsString()
  @MaxLength(500)
  motivo!: string;

  @ApiPropertyOptional({ description: 'Quem trouxe a peça de volta, quando não é o responsável pela OS.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  recebidoDe?: string;

  @ApiProperty({ type: [ItemDevolvidoDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ItemDevolvidoDto)
  itens!: ItemDevolvidoDto[];
}
