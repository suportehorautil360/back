import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

/**
 * Campos editáveis de uma frente de trabalho. Todos opcionais — apenas os
 * presentes no payload são atualizados (as alocações não são tocadas aqui).
 */
export class UpdateWorkFrontDto {
  @ApiPropertyOptional({ description: 'Nome da frente de trabalho' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: 'Endereço da frente de trabalho' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ description: 'Responsável pela frente de trabalho' })
  @IsOptional()
  @IsString()
  responsible?: string;

  @ApiPropertyOptional({
    description: 'Telefone (WhatsApp) da frente de trabalho, em E.164',
  })
  @IsOptional()
  @IsString()
  telefone?: string;

  @ApiPropertyOptional({ description: 'Status atual da frente de trabalho' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({
    description: 'Custo estimado da frente de trabalho (em reais)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  cost?: number;

  @ApiPropertyOptional({
    description: 'Data de início no formato ISO 8601',
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({
    description: 'Data de término no formato ISO 8601',
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}
