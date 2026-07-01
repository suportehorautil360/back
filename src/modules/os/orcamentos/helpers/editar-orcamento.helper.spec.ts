import {
  ordemPermiteEdicao,
  solicitacaoPermiteEdicaoOrcamento,
  solicitacaoPermiteNovoOrcamento,
} from './editar-orcamento.helper';

describe('editar-orcamento.helper', () => {
  it('permite novo orçamento enquanto faltam respostas', () => {
    expect(solicitacaoPermiteNovoOrcamento('aguardando_orcamento')).toBe(true);
    expect(solicitacaoPermiteNovoOrcamento('em_orcamento')).toBe(true);
  });

  it('bloqueia novo orçamento após pregão encerrado', () => {
    expect(solicitacaoPermiteNovoOrcamento('pregao')).toBe(false);
    expect(solicitacaoPermiteNovoOrcamento('aprovado')).toBe(false);
  });

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
