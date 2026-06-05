import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import {
  GREASED_POINT_OPTIONS,
  READING_UNIT_OPTIONS,
} from '../lubrificacoes.types';
import type { GreasedPoint, ReadingUnit } from '../lubrificacoes.types';

export class CreateLubrificacaoDto {
  @ApiProperty({ description: 'Prefecture identifier (tenant).' })
  @IsString()
  @IsNotEmpty()
  prefeituraId!: string;

  @ApiProperty({ description: 'Placa ou chassi do equipamento.' })
  @IsString()
  @IsNotEmpty()
  plateOrChassis!: string;

  @ApiProperty({ description: 'Leitura atual do horímetro ou km.' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  reading!: number;

  @ApiProperty({
    enum: READING_UNIT_OPTIONS,
    description: 'Unidade da leitura.',
    example: 'h',
  })
  @IsIn(READING_UNIT_OPTIONS)
  readingUnit!: ReadingUnit;

  @ApiProperty({
    enum: GREASED_POINT_OPTIONS,
    isArray: true,
    description: 'Pontos engraxados selecionados no app.',
    example: ['boomPins', 'bucket'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(GREASED_POINT_OPTIONS, { each: true })
  greasedPoints!: GreasedPoint[];

  @ApiPropertyOptional({
    description: 'Observação opcional do serviço.',
    example: 'Ponto da lança seco',
  })
  @IsOptional()
  @IsString()
  observation?: string;

  @ApiProperty({ description: 'Latitude capturada automaticamente no app.' })
  @Type(() => Number)
  @IsNumber()
  latitude!: number;

  @ApiProperty({ description: 'Longitude capturada automaticamente no app.' })
  @Type(() => Number)
  @IsNumber()
  longitude!: number;
}
