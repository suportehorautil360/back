import { mapOrdemServicoListItem } from '../../helpers/ordem-servico-list.helper';
import { mapOrdemToOrcamentoApi } from './orcamento-response.helper';

describe('orcamento-response.helper', () => {
  it('expõe itens do orçamento em items', () => {
    const ordem = mapOrdemServicoListItem('ord-1', {
      protocolo: 'OS-2026-010',
      solicitacaoOsId: 'sol-1',
      oficinaId: 'of-1',
      oficinaNome: 'Oficina A',
      equipamento: 'Escavadeira',
      operador: 'João',
      itens: [
        { descricao: 'Filtro hidráulico', valor: 450 },
        { description: 'Mão de obra', value: 800 },
      ],
      valorTotal: 1250,
      prazoDias: 7,
      status: 'em_pregao',
      criadoEm: '2026-06-23T10:00:00.000Z',
    });

    const api = mapOrdemToOrcamentoApi(ordem, 'pregao');

    expect(api.items).toEqual([
      { description: 'Filtro hidráulico', value: 450 },
      { description: 'Mão de obra', value: 800 },
    ]);
    expect(api.valorTotal).toBe(1250);
  });

  it('expõe fotosComprovacao quando presentes', () => {
    const ordem = mapOrdemServicoListItem('ord-1', {
      protocolo: 'OS-2026-010',
      solicitacaoOsId: 'sol-1',
      oficinaId: 'of-1',
      oficinaNome: 'Oficina A',
      itens: [{ descricao: 'Filtro', valor: 100 }],
      valorTotal: 100,
      prazoDias: 7,
      fotosComprovacao: ['https://cdn.example/foto1.jpg'],
      status: 'em_pregao',
      criadoEm: '2026-06-23T10:00:00.000Z',
    });

    const api = mapOrdemToOrcamentoApi(ordem, 'pregao');

    expect(api.fotosComprovacao).toEqual(['https://cdn.example/foto1.jpg']);
  });
});
