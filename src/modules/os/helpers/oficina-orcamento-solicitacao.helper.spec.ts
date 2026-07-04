import {
  assertOficinaTemOrcamentoNaSolicitacao,
  oficinaEnviouOrcamento,
  oficinaTemOrcamentoAprovado,
} from './oficina-orcamento-solicitacao.helper';

describe('oficina-orcamento-solicitacao.helper', () => {
  it('detecta oficina com lance enviado', () => {
    expect(
      oficinaEnviouOrcamento(
        {
          lances: [
            {
              oficinaId: 'of-2',
              valor: 1200,
              prazoDias: 5,
              ordemServicoId: 'ord-1',
            },
          ],
        },
        'of-2',
      ),
    ).toBe(true);
  });

  it('rejeita oficina sem orçamento enviado', () => {
    expect(
      oficinaEnviouOrcamento({ lances: [] }, 'of-2'),
    ).toBe(false);
  });

  it('detecta oficina vencedora com orçamento aprovado', () => {
    expect(
      oficinaTemOrcamentoAprovado(
        {
          status: 'aprovado',
          oficinaVencedoraId: 'of-1',
          lances: [
            {
              oficinaId: 'of-1',
              valor: 1500,
              prazoDias: 7,
              ordemServicoId: 'ord-1',
            },
          ],
        },
        'of-1',
      ),
    ).toBe(true);
  });

  it('rejeita oficina que só enviou orçamento sem aprovação', () => {
    expect(
      oficinaTemOrcamentoAprovado(
        {
          status: 'pregao',
          lances: [
            {
              oficinaId: 'of-1',
              valor: 1500,
              prazoDias: 7,
              ordemServicoId: 'ord-1',
            },
            {
              oficinaId: 'of-2',
              valor: 1400,
              prazoDias: 5,
              ordemServicoId: 'ord-2',
            },
          ],
        },
        'of-1',
      ),
    ).toBe(false);
  });

  it('rejeita oficina perdedora mesmo com lance enviado', () => {
    expect(
      oficinaTemOrcamentoAprovado(
        {
          status: 'aprovado',
          oficinaVencedoraId: 'of-2',
          lances: [
            {
              oficinaId: 'of-1',
              valor: 1500,
              prazoDias: 7,
              ordemServicoId: 'ord-1',
            },
            {
              oficinaId: 'of-2',
              valor: 1400,
              prazoDias: 5,
              ordemServicoId: 'ord-2',
            },
          ],
        },
        'of-1',
      ),
    ).toBe(false);
  });

  it('bloqueia checklist sem orçamento aprovado da oficina', async () => {
    const collection = {
      doc: () => ({
        get: async () => ({
          exists: true,
          data: () => ({
            status: 'pregao',
            lances: [
              {
                oficinaId: 'of-2',
                valor: 1200,
                prazoDias: 5,
                ordemServicoId: 'ord-1',
              },
            ],
          }),
        }),
      }),
    };

    await expect(
      assertOficinaTemOrcamentoNaSolicitacao(
        collection as never,
        'sol-1',
        'of-2',
      ),
    ).rejects.toThrow(
      'Só é possível registrar CHE ou CHD quando o orçamento desta oficina for aprovado pela prefeitura.',
    );
  });
});
