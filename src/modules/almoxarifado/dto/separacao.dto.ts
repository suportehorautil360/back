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

  // Achado Important I2 da revisão da Task 5: campo ausente ("não mexer") é
  // diferente de `null` explícito ("apagar a divergência já registrada") —
  // por isso o tipo aceita `null`, não só `undefined`. `@IsOptional()`
  // trata os dois como "pula validação" (não filtra um do outro); quem
  // distingue é `resolverDivergencia`, no serviço.
  @ApiProperty({
    required: false,
    nullable: true,
    description: 'Peça errada, avariada, a menos. `null` explícito apaga a divergência já registrada.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  divergencia?: string | null;
}

export class SepararDto {
  @ApiProperty({ type: [ItemConferidoDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ItemConferidoDto)
  itens!: ItemConferidoDto[];
}
