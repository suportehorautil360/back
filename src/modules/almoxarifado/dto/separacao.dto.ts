import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class ItemConferidoDto {
  @ApiProperty() @IsUUID() itemId!: string;

  @ApiProperty({ description: 'Quantidade que de fato foi para o kit.' })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  quantidade!: number;

  @ApiProperty({ required: false, description: 'Peça errada, avariada, a menos.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  divergencia?: string;
}

export class SepararDto {
  @ApiProperty({ type: [ItemConferidoDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ItemConferidoDto)
  itens!: ItemConferidoDto[];
}
