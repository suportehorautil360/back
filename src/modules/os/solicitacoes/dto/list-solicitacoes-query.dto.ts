import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { SOLICITACAO_STATUS_OPTIONS } from '../../os.types';

export class ListSolicitacoesQueryDto {
  @ApiPropertyOptional({
    enum: [...SOLICITACAO_STATUS_OPTIONS, 'todos'],
    example: 'aguardando_orcamento',
  })
  @IsOptional()
  @IsIn([...SOLICITACAO_STATUS_OPTIONS, 'todos'])
  status?: string;

  @ApiPropertyOptional({ example: '2026-06-01' })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-06-30' })
  @IsOptional()
  @IsString()
  endDate?: string;
}
