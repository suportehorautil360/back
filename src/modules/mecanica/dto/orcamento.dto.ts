import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { OrcamentoItemDto } from '../../os/orcamentos/dto/create-orcamento.dto';

/**
 * Orçamento da oficina PRÓPRIA.
 *
 * Reusa `OrcamentoItemDto` de propósito: o item gravado em `Orcamento.itens`
 * tem um formato só, e o painel já sabe exibi-lo. Um segundo formato aqui
 * criaria duas verdades sobre o que é um item de orçamento.
 *
 * O que este DTO NÃO tem, e o da parceira tem:
 *
 * - `oficinaId` — não existe oficina; a empresa vem do token (decisão D1).
 * - `fotosComprovacao` obrigatório — na parceira é prova documental de quem
 *   vai cobrar de você. O mecânico de casa já anexa foto na própria OS, e
 *   exigir de novo é atrito no pátio (decisão D2).
 */
export class OrcamentoInternoDto {
  @ApiProperty({
    type: [OrcamentoItemDto],
    description: 'Itens do orçamento. Categoria: part | service | travel.',
  })
  @IsArray()
  @ArrayNotEmpty({ message: 'Informe ao menos um item no orçamento.' })
  @ValidateNested({ each: true })
  @Type(() => OrcamentoItemDto)
  itens!: OrcamentoItemDto[];

  @ApiPropertyOptional({ description: 'Prazo estimado em dias.', example: 3 })
  @IsOptional()
  @IsInt()
  @Min(0)
  prazoDias?: number;

  @ApiPropertyOptional({
    type: [String],
    description: 'URLs de fotos anexadas ao orçamento. Opcional no interno.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  fotos?: string[];
}
