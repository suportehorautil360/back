import {
  assertOficinaTemOrcamentoNaSolicitacao,
  oficinaEnviouOrcamento,
} from './oficina-orcamento-solicitacao.helper';

describe('oficina-orcamento-solicitacao.helper', () => {
  it('detecta oficina em oficinasResponderam', () => {
    expect(
      oficinaEnviouOrcamento({ oficinasResponderam: ['of-1'] }, 'of-1'),
    ).toBe(true);
  });

  it('detecta oficina com lance', () => {
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

  it('rejeita oficina sem orçamento', () => {
    expect(
      oficinaEnviouOrcamento({ oficinasResponderam: ['of-1'] }, 'of-2'),
    ).toBe(false);
  });

  it('bloqueia checklist sem orçamento da oficina', async () => {
    const collection = {
      doc: () => ({
        get: async () => ({
          exists: true,
          data: () => ({ oficinasResponderam: ['of-1'] }),
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
      'Só é possível registrar CHE ou CHD quando a OS tiver orçamento enviado por esta oficina.',
    );
  });
});
