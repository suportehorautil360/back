import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class ListGarantiasEquipamentoQueryDto {
  @ApiPropertyOptional({
    description:
      'Horímetro atual do equipamento para calcular status (vigente/vencendo/vencido)',
    example: '6890,2',
  })
  @IsOptional()
  @IsString()
  horimetroAtual?: string;

  @ApiPropertyOptional({ description: 'Filtra por status calculado' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Filtra por tipo: peca | servico' })
  @IsOptional()
  @IsString()
  tipo?: string;

  @ApiPropertyOptional({ description: 'Busca em peça, serviço ou O.S.' })
  @IsOptional()
  @IsString()
  busca?: string;
}
