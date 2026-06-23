import { shouldIncludeSolicitacaoForOficina } from './solicitacoes-oficina.helper';

describe('shouldIncludeSolicitacaoForOficina', () => {
  const oficinaId = 'of-1';

  it('inclui quando convidada e ainda não respondeu', () => {
    expect(
      shouldIncludeSolicitacaoForOficina(
        { oficinasResponderam: [], prefeituraId: 'pref-a' },
        oficinaId,
      ),
    ).toBe(true);
  });

  it('exclui quando oficina já respondeu em aguardando_orcamento', () => {
    expect(
      shouldIncludeSolicitacaoForOficina(
        { oficinasResponderam: ['of-1'], prefeituraId: 'pref-a' },
        oficinaId,
        undefined,
        'aguardando_orcamento',
      ),
    ).toBe(false);
  });

  it('mantém OS em pregao mesmo após responder', () => {
    expect(
      shouldIncludeSolicitacaoForOficina(
        { oficinasResponderam: ['of-1'], prefeituraId: 'pref-a' },
        oficinaId,
        undefined,
        'pregao',
      ),
    ).toBe(true);
  });

  it('filtra por prefeituraId quando informado', () => {
    expect(
      shouldIncludeSolicitacaoForOficina(
        { oficinasResponderam: [], prefeituraId: 'pref-a' },
        oficinaId,
        'pref-b',
      ),
    ).toBe(false);
  });
});
