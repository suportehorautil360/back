import { Injectable } from '@nestjs/common';
import { ChecklistRuleActionDto } from './dto/answer-checklist-question.dto';

export interface ChecklistFlowResult {
  status: 'in_progress' | 'blocked';
  generatedEmergency: boolean;
  blockReason: string | null;
  actions: ChecklistRuleActionDto[];
}

@Injectable()
export class ChecklistFlowService {
  evaluateAnswer(input: {
    questionId: string;
    questionLabel?: string | null;
    value: unknown;
    problemDescription?: string | null;
    actions?: ChecklistRuleActionDto[];
  }): ChecklistFlowResult {
    const list = [
      ...this.deriveActions(input),
      ...(Array.isArray(input.actions) ? input.actions : []),
    ];
    const blocks = list.find((action) => action.type === 'BLOCK_OPERATION');
    const createsEmergency = list.some(
      (action) => action.type === 'CREATE_EMERGENCY',
    );

    return {
      status: blocks ? 'blocked' : 'in_progress',
      generatedEmergency: createsEmergency,
      blockReason: blocks?.type === 'BLOCK_OPERATION' ? blocks.reason : null,
      actions: list,
    };
  }

  private deriveActions(input: {
    questionId: string;
    questionLabel?: string | null;
    value: unknown;
    problemDescription?: string | null;
  }): ChecklistRuleActionDto[] {
    if (!this.isNegativeAnswer(input.value)) return [];
    const label = this.normalizeText(
      `${input.questionId} ${input.questionLabel ?? ''} ${
        input.problemDescription ?? ''
      }`,
    );
    const rule = CRITICAL_RULES.find((item) =>
      item.keywords.some((keyword) => label.includes(keyword)),
    );
    if (!rule) return [];
    return [
      {
        type: 'CREATE_EMERGENCY',
        severity: rule.severity,
        failureType: rule.failureType,
        description:
          input.problemDescription?.trim() ||
          `Não conformidade crítica: ${input.questionLabel ?? input.questionId}`,
      },
      {
        type: 'BLOCK_OPERATION',
        reason: rule.blockReason,
      },
    ];
  }

  private isNegativeAnswer(value: unknown): boolean {
    if (value === false) return true;
    if (typeof value === 'string') {
      const v = value.trim().toLowerCase();
      return v === 'nao' || v === 'não' || v === 'no' || v === 'false';
    }
    if (value && typeof value === 'object' && 'v' in value) {
      return this.isNegativeAnswer((value as { v?: unknown }).v);
    }
    return false;
  }

  private normalizeText(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }
}

const CRITICAL_RULES: {
  keywords: string[];
  failureType: string;
  severity: 'critical' | 'blocking';
  blockReason: string;
}[] = [
  {
    keywords: ['vazamento de oleo', 'oleo', 'oleos'],
    failureType: 'Vazamento ou irregularidade de óleo',
    severity: 'blocking',
    blockReason: 'Irregularidade crítica em óleo/lubrificação.',
  },
  {
    keywords: ['hidraulico', 'hidraulica', 'cilindros', 'mangueiras'],
    failureType: 'Falha no sistema hidráulico',
    severity: 'blocking',
    blockReason: 'Falha hidráulica pode impedir operação segura.',
  },
  {
    keywords: ['pneu', 'pneus', 'calibragem', 'cortes', 'bolhas'],
    failureType: 'Falha crítica em pneus',
    severity: 'critical',
    blockReason: 'Pneu em condição irregular exige atendimento.',
  },
  {
    keywords: ['freio', 'freios', 'seguranca', 'alarme', 'buzina'],
    failureType: 'Equipamento sem condição segura de operação',
    severity: 'blocking',
    blockReason: 'Item de segurança não conforme.',
  },
  {
    keywords: ['documentacao', 'documento', 'documentos'],
    failureType: 'Ausência de documentação obrigatória',
    severity: 'blocking',
    blockReason: 'Documentação obrigatória ausente.',
  },
];
