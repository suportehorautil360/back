import {
  aplicarFiltrosGarantia,
  chaveGarantiaUnica,
  mesclarLinhasGarantia,
  montarResumoGarantia,
} from './garantias-query.helper';
import type { GarantiaListItem } from '../garantias.types';

function linha(partial: Partial<GarantiaListItem> & Pick<GarantiaListItem, 'id' | 'item'>): GarantiaListItem {
  return {
    osOrigem: 'OS-2026-001',
    dataExec: '20/06/2026',
    tipo: 'peca',
    tipoLabel: 'Peça',
    fornecedor: 'Oficina A',
    prazo: '3 meses',
    limiteHorimetro: '7390 h',
    venceEm: '20/09/2026',
    status: 'vigente',
    horimetroBase: 6890,
    prazoMeses: 3,
    limiteHorimetroNum: 7390,
    venceEmIso: '2026-09-20',
    ...partial,
  };
}

describe('garantias-query.helper', () => {
  it('mescla CHD derivado com persistido (persistido prevalece)', () => {
    const chd = linha({
      id: 'chd-1-peca-0',
      checklistDevolucaoId: 'chd-1',
      item: 'Retentor',
    });
    const persistida = linha({
      id: 'uuid-gravado',
      checklistDevolucaoId: 'chd-1',
      item: 'Retentor',
      status: 'vencendo',
    });

    const merged = mesclarLinhasGarantia([persistida], [chd]);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('uuid-gravado');
    expect(merged[0].status).toBe('vencendo');
  });

  it('aplica filtros de status e busca', () => {
    const rows = [
      linha({ id: '1', item: 'Retentor', status: 'vigente' }),
      linha({ id: '2', item: 'Filtro', status: 'vencido' }),
    ];

    expect(
      aplicarFiltrosGarantia(rows, { status: 'vigente' }),
    ).toHaveLength(1);
    expect(
      aplicarFiltrosGarantia(rows, { busca: 'filtro' }),
    ).toHaveLength(1);
  });

  it('monta resumo com contagem de status', () => {
    const resumo = montarResumoGarantia({
      equipamentoId: 'eq-1',
      equipamento: 'Sany',
      horimetroAtual: 7000,
      linhas: [
        linha({ id: '1', item: 'A', status: 'vigente' }),
        linha({ id: '2', item: 'B', status: 'vencendo' }),
      ],
    });

    expect(resumo.itensEmGarantia).toBe(1);
    expect(resumo.prestesAVencer).toBe(1);
  });

  it('gera chave única por CHD + tipo + item', () => {
    expect(
      chaveGarantiaUnica({
        checklistDevolucaoId: 'chd-1',
        tipo: 'peca',
        item: 'Retentor',
      }),
    ).toBe('chd-1|peca|retentor');
  });
});
