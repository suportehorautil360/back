import {
  mergeLance,
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
});
