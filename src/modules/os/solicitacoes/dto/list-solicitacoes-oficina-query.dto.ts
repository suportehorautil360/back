import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { ListSolicitacoesQueryDto } from './list-solicitacoes-query.dto';

export class ListSolicitacoesOficinaQueryDto extends ListSolicitacoesQueryDto {
  @ApiPropertyOptional({
    description: 'Filtra OS de um município específico.',
    example: 'pref-abc-123',
  })
  @IsOptional()
  @IsString()
  prefeituraId?: string;
}
