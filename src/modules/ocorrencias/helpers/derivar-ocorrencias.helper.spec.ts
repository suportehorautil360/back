import { derivarOcorrenciasOs } from './derivar-ocorrencias.helper';

describe('derivar-ocorrencias.helper', () => {
  it('monta linha do tempo da O.S.', () => {
    const linhas = derivarOcorrenciasOs({
      solicitacaoId: 'sol-1',
      solicitacao: {
        protocolo: 'OS-2026-010',
        equipamento: 'Escavadeira CAT 320',
        operador: 'João Silva',
        criadoEm: '2026-06-08T10:00:00.000Z',
        aprovadoEm: '2026-06-09T15:30:00.000Z',
        status: 'aprovado',
      },
      ordens: [
        {
          id: 'ord-1',
          data: {
            oficinaNome: 'Oficina Silva',
            valorTotal: 552,
            criadoEm: '2026-06-08T13:00:00.000Z',
            aprovadoEm: '2026-06-09T15:30:00.000Z',
          },
        },
      ],
      chds: [
        {
          id: 'chd-1',
          number: 'CHD-2026-0001',
          oficinaId: 'of-1',
          parceiroId: null,
          prefeituraId: 'pref-1',
          solicitacaoOsId: 'sol-1',
          ordemServicoId: 'ord-1',
          identification: {
            os: 'OS-2026-010',
            date: '2026-06-10',
            time: '09:00',
            brandModel: 'CAT 320',
            platePrefix: '',
            currentKm: '',
            hourMeter: '6890 h',
            driver: 'João',
            technicalResponsible: 'Mec. Carlos',
            fuel: 'Cheio',
          },
          generalState: {},
          modules: {},
          parts: { items: [] },
          services: { items: [] },
          closing: {
            inventoryChecked: true,
            driverSignature: '',
            workshopSignature: '',
          },
          status: 'aceito',
          prefeituraConferencia: {
            aceito: true,
            observacoes: null,
            conferidoPor: 'ADM',
            conferidoEm: '2026-06-10T14:00:00.000Z',
          },
          createdAt: '2026-06-10T09:00:00.000Z',
        },
      ],
    });

    expect(linhas.length).toBeGreaterThanOrEqual(4);
    expect(linhas[0].tipo).toBe('chd_aceito');
    expect(linhas.some((l) => l.tipo === 'os_aberta')).toBe(true);
    expect(linhas.some((l) => l.tipo === 'orcamento_enviado')).toBe(true);
    expect(linhas.some((l) => l.mensagem.includes('Oficina Silva'))).toBe(
      true,
    );
  });
});
