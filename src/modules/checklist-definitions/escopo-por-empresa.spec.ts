/**
 * O recorte de `/checklist-definitions`.
 *
 * A rota nasceu servindo um catálogo único, sem empresa, e sem guard nenhum:
 * `GET` respondia 200 com as 17 definições ativas a qualquer um na internet, e
 * `POST`/`PATCH`/`DELETE` estavam igualmente abertos. Agora que a definição
 * pode ser DE UMA EMPRESA, servir tudo a quem não se identificou entregaria o
 * documento interno de um cliente a quem soubesse a URL.
 */
import { ChecklistDefinitionsService } from './checklist-definitions.service';

function servico() {
  const findMany = jest.fn(() => Promise.resolve([]));
  const prisma = { checklistDefinition: { findMany } };
  return {
    servico: new ChecklistDefinitionsService(prisma as never),
    findMany,
  };
}

describe('ChecklistDefinitionsService.findAll — escopo', () => {
  /**
   * O login por CHASSI não tem credencial por desenho, e continua tendo de
   * funcionar. O que ele recebe é o catálogo base — que, antes desta coluna
   * existir, era tudo o que havia: hoje a resposta ao anônimo é exatamente a
   * mesma de sempre.
   */
  it('sem empresa, devolve SÓ o catálogo base', async () => {
    const { servico: s, findMany } = servico();

    await s.findAll(false);

    expect(findMany.mock.calls[0][0].where).toEqual({ companyId: null });
  });

  it('sem empresa, nenhuma definição de cliente vaza nem com filtro de ativas', async () => {
    const { servico: s, findMany } = servico();

    await s.findAll(true);

    expect(findMany.mock.calls[0][0].where).toEqual({
      companyId: null,
      ativo: true,
    });
  });

  // Base MAIS as dela: a resolução de qual vence por categoria é do chamador,
  // que é quem já a aplica no painel e no PWA — a mesma função nos dois.
  it('com empresa, traz o base junto com o dela', async () => {
    const { servico: s, findMany } = servico();

    await s.findAll(false, 'c-1');

    expect(findMany.mock.calls[0][0].where).toEqual({
      OR: [{ companyId: null }, { companyId: 'c-1' }],
    });
  });

  it('com empresa e só ativas, combina os dois recortes', async () => {
    const { servico: s, findMany } = servico();

    await s.findAll(true, 'c-1');

    expect(findMany.mock.calls[0][0].where).toEqual({
      OR: [{ companyId: null }, { companyId: 'c-1' }],
      ativo: true,
    });
  });

  /**
   * `null` e `undefined` chegam os dois: o guard devolve `null` para anônimo, e
   * quem chama o serviço de dentro do back pode simplesmente omitir. Os dois
   * têm de dar no mesmo — um `undefined` tratado como "sem filtro" devolveria
   * o catálogo inteiro.
   */
  it('empresa nula e ausente dão no mesmo recorte', async () => {
    const { servico: s, findMany } = servico();

    await s.findAll(false, null);
    await s.findAll(false);

    expect(findMany.mock.calls[0][0].where).toEqual(
      findMany.mock.calls[1][0].where,
    );
  });

  // String vazia é o resultado de um header mal montado, e nunca uma empresa.
  it('empresa vazia não abre o catálogo', async () => {
    const { servico: s, findMany } = servico();

    await s.findAll(false, '');

    expect(findMany.mock.calls[0][0].where).toEqual({ companyId: null });
  });
});
