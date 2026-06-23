import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsObject, IsOptional, ValidateNested } from 'class-validator';
import {
  ChecklistDevolucaoPartItemDto,
  ChecklistDevolucaoStateItemDto,
} from './create-checklist-devolucao.dto';

export class UpdateChecklistDevolucaoFotosDto {
  @ApiPropertyOptional({
    description: 'Atualiza fotos de anomalias do estado geral (merge por chave)',
    example: {
      limpezaExterna: { status: 'anomaly', photo: 'https://...' },
    },
  })
  @IsOptional()
  @IsObject()
  generalState?: Record<string, ChecklistDevolucaoStateItemDto>;

  @ApiPropertyOptional({
    description:
      'Substitui a lista de peças (use após uploads newPhoto/replacedPhoto por índice)',
    type: [ChecklistDevolucaoPartItemDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChecklistDevolucaoPartItemDto)
  parts?: ChecklistDevolucaoPartItemDto[];
}
