import {
  extrairItensOrcamentoDoc,
  selecionarOrdensParaInsumos,
} from './extrair-itens-orcamento.helper';

describe('extrair-itens-orcamento.helper', () => {
  it('prioriza pecas e mescla com itens', () => {
    const peca = { codigo: '001', descricao: 'Filtro', valor: 120 };
    const linhas = extrairItensOrcamentoDoc({
      pecas: [peca],
      itens: [{ descricao: 'Mão de obra', valor: 80 }],
    });

    expect(linhas).toHaveLength(2);
    expect(linhas[0]).toBe(peca);
  });

  it('prefere orçamento aprovado da solicitação', () => {
    const ordens = [
      { id: 'ord-1', data: () => ({ status: 'recusado' }) },
      { id: 'ord-2', data: () => ({ status: 'em_pregao' }) },
    ] as unknown as FirebaseFirestore.QueryDocumentSnapshot[];

    const sel = selecionarOrdensParaInsumos(ordens, {
      ordemServicoAprovadaId: 'ord-2',
    });

    expect(sel.map((d) => d.id)).toEqual(['ord-2']);
  });
});
