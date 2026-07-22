import {
  classifyRisk,
  getAcaoSugerida,
  isAnswerImpeditivo,
} from './risk-triage.helpers';

describe('risk-triage.helpers — impeditivo', () => {
  it('classifica Alto quando há item impeditivo, mesmo com 1 Não', () => {
    expect(classifyRisk(1, { temImpeditivo: true })).toEqual({
      nivel: 'alto',
      prioridade: 3,
    });
  });

  it('mantém Médio com 1 Não sem impeditivo', () => {
    expect(classifyRisk(1)).toEqual({ nivel: 'medio', prioridade: 2 });
  });

  it('detecta flag impeditivo na resposta', () => {
    expect(isAnswerImpeditivo({ impeditivo: true })).toBe(true);
    expect(isAnswerImpeditivo({ value: { v: 'nao', impeditivo: true } })).toBe(
      true,
    );
    expect(isAnswerImpeditivo({ impeditivo: false })).toBe(false);
  });

  it('sugere ação de emergência quando há impeditivo', () => {
    const acao = getAcaoSugerida({}, 1, { temImpeditivo: true });
    expect(acao).toMatch(/emergencia/i);
  });
});
