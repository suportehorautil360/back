import type { NotaFiscalPrefeituraListItem } from './notas-fiscais-prefeitura.helper';
import {
  calcularResumoNotasFiscais,
  valorContabilNotaFiscal,
} from './notas-fiscais-resumo.helper';

function nf(
  overrides: Partial<NotaFiscalPrefeituraListItem>,
): NotaFiscalPrefeituraListItem {
  return {
    id: '1',
    oficinaId: 'of-1',
    oficinaNome: 'Oficina A',
    description: 'Serviço',
    category: 'servico',
    documentType: 'nfe-55',
    number: '100',
    issuerName: 'Emitente',
    issuedAt: '2026-06-01',
    accessKey: '',
    value: 1000,
    status: 'pendente',
    fileName: 'a.pdf',
    fileUrl: 'https://example.com/a.pdf',
    createdAt: '2026-06-05T10:00:00.000Z',
    osProtocolo: 'OS-1',
    osEquipamento: 'CAT',
    parseCompleteness: 'completo',
    ...overrides,
  };
}

describe('valorContabilNotaFiscal', () => {
  it('usa valor quando leitura completa', () => {
    expect(valorContabilNotaFiscal(nf({ value: 1500 }))).toBe(1500);
  });

  it('ignora valor zero com leitura parcial', () => {
    expect(
      valorContabilNotaFiscal(
        nf({
          value: 0,
          parseCompleteness: 'parcial',
          issuerName: 'Aguardando leitura do PDF',
        }),
      ),
    ).toBe(0);
  });
});

describe('calcularResumoNotasFiscais', () => {
  it('agrega totais, status e gráficos', () => {
    const resumo = calcularResumoNotasFiscais([
      nf({ id: '1', status: 'pendente', value: 1000 }),
      nf({
        id: '2',
        oficinaId: 'of-2',
        oficinaNome: 'Oficina B',
        status: 'aprovada',
        value: 500,
        createdAt: '2026-06-12T10:00:00.000Z',
      }),
    ]);

    expect(resumo.totalNotas).toBe(2);
    expect(resumo.valorTotal).toBe(1500);
    expect(resumo.pendentes).toBe(1);
    expect(resumo.aprovadas).toBe(1);
    expect(resumo.oficinas).toBe(2);
    expect(resumo.porStatus.some((s) => s.label === 'Pendente')).toBe(true);
    expect(resumo.porOficina.length).toBeGreaterThan(0);
  });
});
