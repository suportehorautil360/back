import {
  mergeLance,
  resolveOficinaVencedoraId,
  resolveValorAprovado,
  statusAposOrcamento,
  valorOrcadoForOficina,
} from './lances-os.helper';

describe('lances-os.helper', () => {
  it('calcula valorOrcado da oficina logada', () => {
    const lances = [
      { oficinaId: 'a', valor: 570, prazoDias: 7 },
      { oficinaId: 'b', valor: 519, prazoDias: 10 },
    ];
    expect(valorOrcadoForOficina(lances, 'a')).toBe(570);
    expect(valorOrcadoForOficina(lances, 'c')).toBeNull();
  });

  it('substitui lance existente da mesma oficina', () => {
    const merged = mergeLance(
      [{ oficinaId: 'a', valor: 100, prazoDias: 5 }],
      { oficinaId: 'a', valor: 200, prazoDias: 7 },
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].valor).toBe(200);
  });

  it('define status em_orcamento ou pregao', () => {
    expect(
      statusAposOrcamento(['a', 'b'], ['a']),
    ).toBe('em_orcamento');
    expect(
      statusAposOrcamento(['a', 'b'], ['a', 'b']),
    ).toBe('pregao');
  });

  it('resolve oficina vencedora pelo orçamento aprovado', () => {
    const lances = [
      { oficinaId: 'of-a', valor: 570, prazoDias: 7, ordemServicoId: 'ord-a' },
      { oficinaId: 'of-b', valor: 519, prazoDias: 10, ordemServicoId: 'ord-b' },
    ];

    expect(
      resolveOficinaVencedoraId(
        { ordemServicoAprovadaId: 'ord-b' },
        lances,
      ),
    ).toBe('of-b');
  });

  it('prioriza oficinaVencedoraId explícito', () => {
    expect(
      resolveOficinaVencedoraId(
        {
          oficinaVencedoraId: 'of-a',
          ordemServicoAprovadaId: 'ord-b',
        },
        [{ oficinaId: 'of-b', valor: 100, prazoDias: 5, ordemServicoId: 'ord-b' }],
      ),
    ).toBe('of-a');
  });

  it('resolve valor aprovado da oficina vencedora', () => {
    const lances = [
      { oficinaId: 'of-a', valor: 570, prazoDias: 7, ordemServicoId: 'ord-a' },
      { oficinaId: 'of-b', valor: 519, prazoDias: 10, ordemServicoId: 'ord-b' },
    ];

    expect(resolveValorAprovado({}, lances, 'of-b')).toBe(519);
  });
});
