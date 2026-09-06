import { resolverLedger, type RegistroPonto } from './ledger';

function reg(
  p: Partial<RegistroPonto> & { id: string; nsr: number },
): RegistroPonto {
  return {
    tipo: 'entrada',
    timestampOriginal: '2026-09-06T10:00:00.000Z',
    operatorNome: 'Ana',
    operatorCpf: '12345678901',
    registro: 'original',
    refNsr: null,
    refId: null,
    aplicado: true,
    motivo: null,
    motivoReprovacao: null,
    createdAt: '2026-09-06T10:00:00.000Z',
    ...p,
  };
}

describe('resolverLedger', () => {
  it('devolve a original quando nada a corrige', () => {
    const r = resolverLedger([reg({ id: 'a', nsr: 1 })]);
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('a');
  });

  it('cancelamento aplicado remove a original da visão efetiva', () => {
    // Sem apagá-la do ledger — a Portaria 671 não permite apagar.
    const r = resolverLedger([
      reg({ id: 'a', nsr: 1 }),
      reg({
        id: 'c',
        nsr: 2,
        registro: 'cancelamento',
        refNsr: 1,
        aplicado: true,
      }),
    ]);
    expect(r).toHaveLength(0);
  });

  it('cancelamento NÃO aplicado deixa a original em pé', () => {
    const r = resolverLedger([
      reg({ id: 'a', nsr: 1 }),
      reg({
        id: 'c',
        nsr: 2,
        registro: 'cancelamento',
        refNsr: 1,
        aplicado: false,
      }),
    ]);
    expect(r.map((x) => x.id)).toEqual(['a']);
  });

  it('ajuste aplicado troca o horário oficial e guarda o anterior', () => {
    const r = resolverLedger([
      reg({ id: 'a', nsr: 1, timestampOriginal: '2026-09-06T10:00:00.000Z' }),
      reg({
        id: 'j',
        nsr: 2,
        registro: 'ajuste',
        refNsr: 1,
        aplicado: true,
        timestampOriginal: '2026-09-06T09:30:00.000Z',
      }),
    ]);
    expect(r[0].timestampOriginal).toBe('2026-09-06T09:30:00.000Z');
    expect(r[0].horarioAnterior).toBe('2026-09-06T10:00:00.000Z');
  });

  it('ajuste pendente mantém o horário original e sinaliza', () => {
    const r = resolverLedger([
      reg({ id: 'a', nsr: 1, timestampOriginal: '2026-09-06T10:00:00.000Z' }),
      reg({
        id: 'j',
        nsr: 2,
        registro: 'ajuste',
        refNsr: 1,
        aplicado: false,
        timestampOriginal: '2026-09-06T09:30:00.000Z',
      }),
    ]);
    expect(r[0].timestampOriginal).toBe('2026-09-06T10:00:00.000Z');
    expect(r[0].ajustePendente).toBe(true);
  });

  it('ajuste reprovado não conta como pendente', () => {
    const r = resolverLedger([
      reg({ id: 'a', nsr: 1 }),
      reg({
        id: 'j',
        nsr: 2,
        registro: 'ajuste',
        refNsr: 1,
        aplicado: false,
        motivoReprovacao: 'sem justificativa',
      }),
    ]);
    expect(r[0].ajustePendente).toBeUndefined();
  });

  it('inclusão aprovada (ajuste sem alvo) vira batida própria', () => {
    const r = resolverLedger([
      reg({
        id: 'i',
        nsr: 5,
        registro: 'ajuste',
        refNsr: null,
        refId: null,
        aplicado: true,
        tipo: 'saida',
      }),
    ]);
    expect(r.map((x) => x.tipo)).toEqual(['saida']);
  });

  it('inclusão não aprovada não aparece', () => {
    const r = resolverLedger([
      reg({
        id: 'i',
        nsr: 5,
        registro: 'ajuste',
        refNsr: null,
        refId: null,
        aplicado: false,
      }),
    ]);
    expect(r).toHaveLength(0);
  });

  it('mira por refId quando o alvo não tem NSR conhecido', () => {
    const r = resolverLedger([
      reg({ id: 'a', nsr: 1 }),
      reg({
        id: 'c',
        nsr: 2,
        registro: 'cancelamento',
        refNsr: null,
        refId: 'a',
        aplicado: true,
      }),
    ]);
    expect(r).toHaveLength(0);
  });

  it('entre dois ajustes aplicados vale o de NSR maior', () => {
    const r = resolverLedger([
      reg({ id: 'a', nsr: 1 }),
      reg({
        id: 'j1',
        nsr: 2,
        registro: 'ajuste',
        refNsr: 1,
        aplicado: true,
        timestampOriginal: '2026-09-06T09:00:00.000Z',
      }),
      reg({
        id: 'j2',
        nsr: 3,
        registro: 'ajuste',
        refNsr: 1,
        aplicado: true,
        timestampOriginal: '2026-09-06T08:00:00.000Z',
      }),
    ]);
    expect(r[0].timestampOriginal).toBe('2026-09-06T08:00:00.000Z');
  });
});
