import {
  buildOsResolucaoMaps,
  equipamentoFromSolicitacaoDoc,
  filtrarNotasFiscaisPrefeitura,
  nomeOficinaFromDoc,
  protocoloFromSolicitacaoDoc,
  resolverOsDaNotaFiscal,
  type NotaFiscalPrefeituraListItem,
} from './notas-fiscais-prefeitura.helper';
import type { NotaFiscalApiItem } from '../notas-fiscais.types';

function nfBase(
  overrides: Partial<NotaFiscalApiItem> = {},
): NotaFiscalApiItem {
  return {
    id: 'nf-1',
    oficinaId: 'of-1',
    description: 'Serviço',
    category: 'servico',
    documentType: 'nfe-55',
    number: '123',
    issuerName: 'Emitente',
    issuedAt: '2026-06-01',
    accessKey: '',
    value: 1500,
    status: 'pendente',
    fileName: 'nf.pdf',
    fileUrl: 'https://example.com/nf.pdf',
    createdAt: '2026-06-10T12:00:00.000Z',
    ...overrides,
  };
}

describe('resolverOsDaNotaFiscal', () => {
  const maps = buildOsResolucaoMaps(
    [
      {
        id: 'sol-1',
        data: {
          protocolo: 'OS-2026-001',
          equipamento: 'Retro CAT',
          ordemServicoAprovadaId: 'ord-1',
        },
      },
      {
        id: 'sol-2',
        data: {
          protocol: 'OS-2026-002',
          equipment: 'Caminhão VW',
          ordemServicoAprovadaId: 'ord-2',
        },
      },
    ],
    [
      {
        id: 'ord-1',
        data: {
          solicitacaoOsId: 'sol-1',
          oficinaId: 'of-1',
          status: 'aprovado',
          valorTotal: 1500,
          criadoEm: '2026-06-01T10:00:00.000Z',
        },
      },
      {
        id: 'ord-2',
        data: {
          solicitacaoOsId: 'sol-2',
          oficinaId: 'of-2',
          status: 'aprovado',
          valorTotal: 800,
          criadoEm: '2026-06-03T10:00:00.000Z',
        },
      },
    ],
  );

  it('resolve pelo solicitacaoOsId', () => {
    const r = resolverOsDaNotaFiscal(
      nfBase({ solicitacaoOsId: 'sol-1', oficinaId: 'of-1' }),
      maps,
    );
    expect(r.osProtocolo).toBe('OS-2026-001');
    expect(r.osEquipamento).toBe('Retro CAT');
  });

  it('infere O.S. pela oficina + valor quando falta solicitacaoOsId', () => {
    const r = resolverOsDaNotaFiscal(
      nfBase({ oficinaId: 'of-2', value: 800 }),
      maps,
    );
    expect(r.osProtocolo).toBe('OS-2026-002');
    expect(r.solicitacaoOsId).toBe('sol-2');
  });

  it('infere ordem aprovada vinculada à solicitação', () => {
    const r = resolverOsDaNotaFiscal(nfBase({ oficinaId: 'of-1' }), maps);
    expect(r.osProtocolo).toBe('OS-2026-001');
    expect(r.ordemServicoId).toBe('ord-1');
  });
});

describe('filtrarNotasFiscaisPrefeitura', () => {
  const base: NotaFiscalPrefeituraListItem[] = [
    {
      ...nfBase({
        id: '1',
        solicitacaoOsId: 'sol-1',
        prefeituraId: 'pref-1',
      }),
      oficinaNome: 'Oficina Silva',
      osProtocolo: 'OS-2026-001',
      osEquipamento: 'Retroescavadeira CAT',
    },
    {
      ...nfBase({
        id: '2',
        oficinaId: 'of-2',
        solicitacaoOsId: 'sol-2',
        prefeituraId: 'pref-1',
        value: 800,
        status: 'aprovada',
        number: '99999',
        createdAt: '2026-06-04T10:00:00.000Z',
      }),
      oficinaNome: 'Auto Center',
      osProtocolo: 'OS-2026-002',
      osEquipamento: 'Caminhão VW',
    },
  ];

  it('filtra por status', () => {
    const r = filtrarNotasFiscaisPrefeitura(base, { status: 'aprovada' });
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('2');
  });

  it('filtra por oficinaId', () => {
    const r = filtrarNotasFiscaisPrefeitura(base, { oficinaId: 'of-1' });
    expect(r).toHaveLength(1);
    expect(r[0].oficinaNome).toBe('Oficina Silva');
  });

  it('filtra por busca em protocolo e número', () => {
    expect(
      filtrarNotasFiscaisPrefeitura(base, { busca: 'OS-2026-001' }),
    ).toHaveLength(1);
    expect(filtrarNotasFiscaisPrefeitura(base, { busca: '99999' })).toHaveLength(
      1,
    );
  });
});

describe('nomeOficinaFromDoc', () => {
  it('prioriza nome fantasia', () => {
    expect(
      nomeOficinaFromDoc(
        { nomeFantasia: 'Silva Oficina', razaoSocial: 'Silva LTDA' },
        'of-1',
      ),
    ).toBe('Silva Oficina');
  });
});

describe('protocoloFromSolicitacaoDoc', () => {
  it('lê protocolo PT ou EN', () => {
    expect(protocoloFromSolicitacaoDoc({ protocolo: 'OS-1' })).toBe('OS-1');
    expect(protocoloFromSolicitacaoDoc({ protocol: 'OS-2' })).toBe('OS-2');
  });

  it('lê equipamento PT ou EN', () => {
    expect(equipamentoFromSolicitacaoDoc({ equipamento: 'CAT' })).toBe('CAT');
    expect(equipamentoFromSolicitacaoDoc({ equipment: 'VW' })).toBe('VW');
  });
});
