import { ApiProperty } from '@nestjs/swagger';
import type { CategoriaPlano } from '../planos-preventivos.types';

export class SalvarPlanoPreventivoDto {
  @ApiProperty({
    type: 'array',
    description: 'Cada categoria possui a própria matriz (ciclos × linhas).',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        nome: { type: 'string' },
        ciclos: { type: 'array' },
        linhas: { type: 'array' },
      },
    },
  })
  categorias!: CategoriaPlano[];
}
