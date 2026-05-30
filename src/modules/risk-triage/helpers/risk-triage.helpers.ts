export type RiskLevel = 'alto' | 'medio' | 'baixo';

export function toSafeString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

export function toSafeMillis(value: unknown): number {
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as { toDate: () => Date }).toDate === 'function'
  ) {
    return (value as { toDate: () => Date }).toDate().getTime();
  }

  return 0;
}

export function normalizeText(value?: string): string {
  return toSafeString(value)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function toDateFilterIso(value?: string): string | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return undefined;
  return new Date(parsed).toISOString();
}

export function extractAnswerRawValue(value: unknown): unknown {
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (obj.v !== undefined) return obj.v;
    if (obj.valor !== undefined) return obj.valor;
    if (obj.value !== undefined) return obj.value;
    if (obj.resposta !== undefined) return obj.resposta;
  }
  return value;
}

export function extractProblemDescription(
  answer: Record<string, unknown>,
  value: unknown,
): string {
  const fromField = toSafeString(answer.problemDescription).trim();
  if (fromField) return fromField;

  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const fromValue =
      toSafeString(obj.problema).trim() ||
      toSafeString(obj.descricao).trim() ||
      toSafeString(obj.observacao).trim();
    if (fromValue) return fromValue;
  }

  return '';
}

export function normalizeAnswerValue(value: unknown): 'sim' | 'nao' | 'outro' {
  const rawValue = extractAnswerRawValue(value);

  if (typeof rawValue === 'boolean') {
    return rawValue ? 'sim' : 'nao';
  }

  const normalized = normalizeText(toSafeString(rawValue));

  if (normalized === 'sim' || normalized === 'yes' || normalized === 'ok') {
    return 'sim';
  }

  if (normalized === 'nao' || normalized === 'no') {
    return 'nao';
  }

  return 'outro';
}

export function classifyRisk(totalNao: number): {
  nivel: RiskLevel;
  prioridade: 3 | 2 | 1;
} {
  if (totalNao >= 2) return { nivel: 'alto', prioridade: 3 };
  if (totalNao === 1) return { nivel: 'medio', prioridade: 2 };
  return { nivel: 'baixo', prioridade: 1 };
}

export function getNomeEquipamento(runData: Record<string, unknown>): string {
  return (
    toSafeString(runData.nomeEquipamento) ||
    toSafeString(runData.equipamentoNome) ||
    toSafeString(runData.categoria) ||
    toSafeString(runData.equipamentoId) ||
    toSafeString(runData.chassis) ||
    'Equipamento nao identificado'
  );
}

export function getNomeOperador(runData: Record<string, unknown>): string {
  return (
    toSafeString(runData.operadorNome) ||
    toSafeString(runData.operador) ||
    'Operador nao informado'
  );
}

export function getAcaoSugerida(
  runData: Record<string, unknown>,
  totalNao: number,
): string {
  const blockReason = toSafeString(runData.blockReason);
  if (blockReason) return `Bloquear operacao: ${blockReason}`;

  const generatedEmergencyIds = Array.isArray(runData.generatedEmergencyIds)
    ? runData.generatedEmergencyIds
    : [];
  if (generatedEmergencyIds.length > 0) {
    return 'Acionar equipe de manutencao imediatamente (emergencia gerada).';
  }

  if (totalNao >= 2) {
    return 'Acionar manutencao imediata e impedir operacao ate regularizacao.';
  }

  if (totalNao === 1) {
    return 'Agendar correcao e realizar nova inspecao antes da proxima operacao.';
  }

  return 'Sem acao imediata. Manter monitoramento preventivo.';
}

export function resolveDefeito(params: {
  questionId?: string;
  questionLabel?: string;
  problemDescription?: string;
}): string {
  const { questionId, questionLabel, problemDescription } = params;

  const descricaoLivre = toSafeString(problemDescription).trim();
  if (descricaoLivre) return descricaoLivre;

  const questionIdNorm = normalizeText(questionId).replace(/\s+/g, '_');
  switch (questionIdNorm) {
    case 'buzina':
      return 'Falha na buzina de seguranca';
    case 'luzes_de_trabalho':
      return 'Falha na iluminacao de trabalho';
    case 'alarme_de_re':
      return 'Falha no alarme de re';
    case 'freio':
      return 'Falha no sistema de freio';
    case 'nivel_de_oleo':
      return 'Nivel de oleo fora do padrao';
    case 'filtro_de_ar':
      return 'Falha no filtro de ar';
    case 'separador_dagua':
      return 'Falha no separador de agua';
    case 'extintor':
      return 'Extintor ausente, vencido ou irregular';
    case 'pneus':
      return 'Pneus em condicao irregular';
    case 'sistema_hidraulico':
      return 'Falha no sistema hidraulico';
    default:
      break;
  }

  const questionLabelNorm = normalizeText(questionLabel);
  if (questionLabelNorm.includes('buzina'))
    return 'Falha na buzina de seguranca';
  if (
    questionLabelNorm.includes('luz') &&
    questionLabelNorm.includes('trabalho')
  )
    return 'Falha na iluminacao de trabalho';
  if (questionLabelNorm.includes('alarme') && questionLabelNorm.includes('re'))
    return 'Falha no alarme de re';
  if (questionLabelNorm.includes('freio')) return 'Falha no sistema de freio';
  if (questionLabelNorm.includes('oleo')) return 'Nivel de oleo fora do padrao';
  if (questionLabelNorm.includes('filtro') && questionLabelNorm.includes('ar'))
    return 'Falha no filtro de ar';
  if (
    questionLabelNorm.includes('separador') &&
    questionLabelNorm.includes('agua')
  )
    return 'Falha no separador de agua';
  if (questionLabelNorm.includes('extintor'))
    return 'Extintor ausente, vencido ou irregular';
  if (questionLabelNorm.includes('pneu')) return 'Pneus em condicao irregular';
  if (questionLabelNorm.includes('hidraulic'))
    return 'Falha no sistema hidraulico';

  return (
    toSafeString(questionLabel).trim() ||
    toSafeString(questionId).trim() ||
    'Sem defeito identificado'
  );
}
