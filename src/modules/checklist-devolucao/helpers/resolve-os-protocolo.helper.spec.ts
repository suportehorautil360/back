import {
  mergeIdentificationOs,
  resolveOsProtocolo,
} from './resolve-os-protocolo.helper';

const solicitacoes = {
  doc: jest.fn(),
} as unknown as {
  doc: jest.Mock;
};

describe('resolve-os-protocolo.helper', () => {
  beforeEach(() => {
    solicitacoes.doc.mockReset();
  });

  it('usa identification.os quando informado', async () => {
    const os = await resolveOsProtocolo(
      {
        identification: { os: 'OS-2026-047' },
      } as never,
      solicitacoes as never,
    );
    expect(os).toBe('OS-2026-047');
  });

  it('aceita protocolo na raiz do body', async () => {
    const os = await resolveOsProtocolo(
      { protocolo: 'OS-2026-010' } as never,
      solicitacoes as never,
    );
    expect(os).toBe('OS-2026-010');
  });

  it('busca protocolo na solicitacaoOsId', async () => {
    solicitacoes.doc.mockReturnValue({
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({ protocolo: 'OS-2026-099' }),
      }),
    });

    const os = await resolveOsProtocolo(
      { solicitacaoOsId: 'sol-1' } as never,
      solicitacoes as never,
    );
    expect(os).toBe('OS-2026-099');
    expect(solicitacoes.doc).toHaveBeenCalledWith('sol-1');
  });

  it('mergeIdentificationOs preenche os no DTO', () => {
    const merged = mergeIdentificationOs(
      {
        identification: {
          date: '2026-06-20',
          time: '10:00',
          brandModel: 'CAT',
          platePrefix: 'X',
          currentKm: '1',
          hourMeter: '2',
          driver: 'A',
          technicalResponsible: 'B',
          fuel: '1/2',
        },
      } as never,
      'OS-2026-047',
    );
    expect(merged.identification.os).toBe('OS-2026-047');
  });
});
