import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { OrcamentoItemDto } from './create-orcamento.dto';

export class UpdateOrcamentoDto {
  @ApiProperty({ description: 'Document ID da oficina dona do orçamento' })
  @IsString()
  oficinaId!: string;

  @ApiProperty({ type: [OrcamentoItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrcamentoItemDto)
  items!: OrcamentoItemDto[];

  @ApiPropertyOptional({ example: 7, description: 'Prazo de entrega em dias' })
  @IsOptional()
  @IsInt()
  @Min(1)
  prazoDias?: number;
}
