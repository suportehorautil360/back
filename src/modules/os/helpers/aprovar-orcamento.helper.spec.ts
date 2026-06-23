import {
  ordemElegivelParaAprovacao,
  solicitacaoPermiteAprovacao,
} from './aprovar-orcamento.helper';

describe('aprovar-orcamento.helper', () => {
  it('permite aprovar solicitação em pregao', () => {
    expect(solicitacaoPermiteAprovacao('pregao')).toBe(true);
    expect(solicitacaoPermiteAprovacao('em_orcamento')).toBe(true);
  });

  it('bloqueia solicitação já aprovada', () => {
    expect(solicitacaoPermiteAprovacao('aprovado')).toBe(false);
  });

  it('aceita orçamento em_pregao e aguardando_aprovacao', () => {
    expect(ordemElegivelParaAprovacao('em_pregao')).toBe(true);
    expect(ordemElegivelParaAprovacao('aguardando_aprovacao')).toBe(true);
    expect(ordemElegivelParaAprovacao('recusado')).toBe(false);
  });
});
