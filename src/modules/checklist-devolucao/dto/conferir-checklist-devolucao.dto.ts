import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class ConferirChecklistDevolucaoDto {
  @ApiProperty({ description: 'true = prefeitura aceita a devolução' })
  @IsBoolean()
  aceito!: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  observacoes?: string;

  @ApiPropertyOptional({
    description: 'Nome ou id do responsável pela conferência',
  })
  @IsOptional()
  @IsString()
  conferidoPor?: string;
}
