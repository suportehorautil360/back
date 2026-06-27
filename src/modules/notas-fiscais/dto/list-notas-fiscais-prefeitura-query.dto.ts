import { IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { NOTA_FISCAL_STATUS } from '../notas-fiscais.types';

export class ListNotasFiscaisPrefeituraQueryDto {
  @IsOptional()
  @IsString()
  busca?: string;

  @IsOptional()
  @IsString()
  oficinaId?: string;

  @IsOptional()
  @IsIn([...NOTA_FISCAL_STATUS, 'todos'])
  status?: (typeof NOTA_FISCAL_STATUS)[number] | 'todos';

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'startDate deve estar no formato YYYY-MM-DD.',
  })
  startDate?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'endDate deve estar no formato YYYY-MM-DD.',
  })
  endDate?: string;
}