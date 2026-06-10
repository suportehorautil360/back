import { ApiProperty } from '@nestjs/swagger';

export type ChecklistItemSeveridade = 'impeditivo' | 'normal';

/** Item de verificação de uma definição de checklist. */
export class ChecklistDefinitionItemDto {
  @ApiProperty({ description: 'Ordem de exibição (1..N)', example: 1 })
  ordem!: number;

  @ApiProperty({
    description: 'Texto da pergunta/item a checar',
    example: 'Facas e contrafacas estão sem trincas, quebras ou desgaste?',
  })
  texto!: string;

  @ApiProperty({
    description:
      'Severidade: "impeditivo" abre emergência/bloqueio quando respondido "não".',
    enum: ['impeditivo', 'normal'],
    example: 'impeditivo',
  })
  severidade!: ChecklistItemSeveridade;
}

/**
 * Definição (modelo/variante) de checklist do operador. Catálogo GLOBAL — sem
 * `prefeituraId`. Editável pelo painel admin.
 */
export class CreateChecklistDefinitionDto {
  @ApiProperty({
    description: 'Nome amigável da definição',
    example: 'Picador de Madeira',
  })
  nome!: string;

  @ApiProperty({
    description:
      'Categoria canônica usada como rótulo de match e gravada no run.',
    example: 'Picador de Madeira',
  })
  categoria!: string;

  @ApiProperty({
    description:
      'Palavras-chave (minúsculas) para casar o equipamento por nome/modelo.',
    type: [String],
    example: ['picador', 'picador de madeira', 'chipper'],
  })
  keywords!: string[];

  @ApiProperty({
    description: 'Itens de verificação do checklist',
    type: [ChecklistDefinitionItemDto],
  })
  itens!: ChecklistDefinitionItemDto[];

  @ApiProperty({
    description: 'Se a definição está ativa (disponível para o operador).',
    required: false,
    default: true,
  })
  ativo?: boolean;
}
