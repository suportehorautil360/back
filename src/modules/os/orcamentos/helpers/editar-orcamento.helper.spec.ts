import {
  ordemPermiteEdicao,
  solicitacaoPermiteEdicaoOrcamento,
} from './editar-orcamento.helper';

describe('editar-orcamento.helper', () => {
  it('permite edição em pregão', () => {
    expect(solicitacaoPermiteEdicaoOrcamento('pregao')).toBe(true);
    expect(solicitacaoPermiteEdicaoOrcamento('em_orcamento')).toBe(true);
  });

  it('bloqueia edição após aprovação', () => {
    expect(solicitacaoPermiteEdicaoOrcamento('aprovado')).toBe(false);
    expect(solicitacaoPermiteEdicaoOrcamento('concluido')).toBe(false);
  });

  it('valida status da ordem', () => {
    expect(ordemPermiteEdicao('em_pregao')).toBe(true);
    expect(ordemPermiteEdicao('aprovado')).toBe(false);
  });
});
