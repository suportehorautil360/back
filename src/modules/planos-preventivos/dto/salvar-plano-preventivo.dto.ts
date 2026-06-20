import { ApiProperty } from '@nestjs/swagger';
import type { CicloMatriz, LinhaMatriz } from '../planos-preventivos.types';

export class SalvarPlanoPreventivoDto {
  @ApiProperty({
    type: 'array',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        horas: { type: 'number' },
        km: { type: 'number' },
        titulo: { type: 'string' },
      },
    },
  })
  ciclos!: CicloMatriz[];

  @ApiProperty({
    type: 'array',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        categoria: { type: 'string' },
        item: { type: 'string' },
        especificacao: { type: 'string' },
        acoes: { type: 'object', additionalProperties: { type: 'string' } },
      },
    },
  })
  linhas!: LinhaMatriz[];
}
