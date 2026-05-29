import { ApiProperty } from '@nestjs/swagger';

export class AnswerChecklistQuestionDto {
  @ApiProperty({ example: 'oleo_vazamento' })
  questionId!: string;

  @ApiProperty({ example: 'Possui vazamento de óleo?', required: false })
  questionLabel?: string;

  @ApiProperty({ example: 'sim' })
  value!: unknown;

  @ApiProperty({ example: 'Vazamento próximo ao motor', required: false })
  problemDescription?: string;

  @ApiProperty({ type: [String], required: false })
  photoUrls?: string[];

  @ApiProperty({
    required: false,
    description: 'Ações calculadas pelo motor de regras/definição versionada.',
  })
  actions?: ChecklistRuleActionDto[];
}

export type ChecklistRuleActionDto =
  | {
      type: 'CREATE_EMERGENCY';
      severity?: 'warning' | 'critical' | 'blocking';
      failureType: string;
      description?: string;
    }
  | {
      type: 'BLOCK_OPERATION';
      reason: string;
    };
