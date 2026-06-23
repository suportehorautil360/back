import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsObject, IsOptional, ValidateNested } from 'class-validator';
import {
  ChecklistChegadaItemDto,
  ChecklistChegadaPhotosDto,
} from './create-checklist-chegada.dto';

export class UpdateChecklistChegadaFotosDto {
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => ChecklistChegadaPhotosDto)
  photos?: ChecklistChegadaPhotosDto;

  @ApiPropertyOptional({
    description: 'Atualiza fotos de itens com anomalia (campo photo por item)',
  })
  @IsOptional()
  @IsObject()
  inspection?: Record<string, ChecklistChegadaItemDto>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  blocks?: Record<string, ChecklistChegadaItemDto>;
}
