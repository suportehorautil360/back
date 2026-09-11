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

  // As da empresa vêm também arquivadas: é o que diz quais categorias ela
  // excluiu, para o base não voltar no lugar.
  it('com empresa e só ativas, traz o base ativo e TODAS as dela', async () => {
    const { servico: s, findMany } = servico();

    await s.findAll(true, 'c-1');

    expect(findMany.mock.calls[0][0].where).toEqual({
      OR: [{ companyId: null, ativo: true }, { companyId: 'c-1' }],
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

/**
 * O que o aparelho do operador recebe no login por CHASSI.
 *
 * Ele usa a lista como vem — não sabe de empresa nenhuma. Devolver o base e o
 * da empresa lado a lado para a mesma categoria deixava a escolha para a
 * pontuação por palavra-chave, e o operador podia preencher o documento que a
 * empresa trocou. Quem pede só as ativas recebe UMA por categoria.
 */
describe('ChecklistDefinitionsService.findAll — o que vale para a empresa', () => {
  const agora = new Date('2026-09-11T12:00:00Z');
  const linha = (
    id: string,
    categoria: string,
    companyId: string | null,
    ativo = true,
  ) => ({
    id,
    legacyId: null,
    companyId,
    nome: `${categoria} (${id})`,
    categoria,
    keywords: [],
    ativo,
    version: 1,
    itens: [],
    createdAt: agora,
    updatedAt: agora,
  });

  function servicoCom(linhas: ReturnType<typeof linha>[]) {
    const findMany = jest.fn(() => Promise.resolve(linhas));
    return new ChecklistDefinitionsService({
      checklistDefinition: { findMany },
    } as never);
  }

  it('a da empresa substitui o base da mesma categoria', async () => {
    const s = servicoCom([
      linha('base-retro', 'Retroescavadeira', null),
      linha('base-bau', 'Baú', null),
      linha('emp-retro', 'retroescavadeira ', 'c-1'),
    ]);

    const r = await s.findAll(true, 'c-1');

    expect(r.data.map((d) => d.id).sort()).toEqual(['base-bau', 'emp-retro']);
  });

  it('a excluída pela empresa esconde o base, e não aparece ela mesma', async () => {
    const s = servicoCom([
      linha('base-comboio', 'Comboio', null),
      linha('emp-comboio', 'Comboio', 'c-1', false),
      linha('base-bau', 'Baú', null),
    ]);

    const r = await s.findAll(true, 'c-1');

    expect(r.data.map((d) => d.id)).toEqual(['base-bau']);
  });

  // Sem o filtro de ativas é a leitura de quem mantém o catálogo: lá o
  // trabalho é ver tudo, então nada é escondido.
  it('sem o filtro de ativas, não resolve nada', async () => {
    const s = servicoCom([
      linha('base-comboio', 'Comboio', null),
      linha('emp-comboio', 'Comboio', 'c-1', false),
    ]);

    const r = await s.findAll(false, 'c-1');

    expect(r.data).toHaveLength(2);
  });
});
