import {
  categoriaECicloExistem,
  itensDeTrocaDoCiclo,
  parseQuantidade,
  resolverPeca,
} from './plano-pecas';

const categorias = [
  {
    id: 'cat-filtros',
    nome: 'Filtros',
    // `c2` existe mas nenhuma linha tem ação pra ele — ciclo só de inspeção,
    // usado no teste de `categoriaECicloExistem` que distingue "existe e não
    // tem item de troca" (legítimo) de "não existe" (erro de digitação).
    ciclos: [{ id: 'c1', titulo: 'Ciclo 1' }, { id: 'c2', titulo: 'Ciclo 2 (só inspeção)' }],
    linhas: [
      { id: 'l1', item: 'Filtro de óleo', codigoPeca: '32925682', quantidade: '1', pecaId: 'p-1', acoes: { c1: 'trocar' } },
      { id: 'l2', item: 'Óleo 15W-40', codigoPeca: 'CQM20136', quantidade: '15L', acoes: { c1: 'medir_trocar' } },
      { id: 'l3', item: 'Nível do radiador', acoes: { c1: 'inspecionar' } },
      { id: 'l4', item: 'Filtro de cabine', acoes: { c1: 'na' } },
    ],
  },
];

describe('itensDeTrocaDoCiclo', () => {
  it('só trocar e medir_trocar consomem peça', () => {
    // `inspecionar` e `na` não tiram nada da prateleira. Incluí-los faria a
    // OS reservar peça que ninguém vai usar.
    expect(itensDeTrocaDoCiclo(categorias, 'cat-filtros', 'c1').map((i) => i.linhaId))
      .toEqual(['l1', 'l2']);
  });

  it('categoria ou ciclo inexistente devolve vazio, não lança', () => {
    expect(itensDeTrocaDoCiclo(categorias, 'nao-existe', 'c1')).toEqual([]);
    expect(itensDeTrocaDoCiclo(categorias, 'cat-filtros', 'c9')).toEqual([]);
  });

  it('categorias que não são array devolvem vazio', () => {
    // `PlanoPreventivo.categorias` é coluna Json: o banco não garante nada.
    expect(itensDeTrocaDoCiclo(null, 'cat-filtros', 'c1')).toEqual([]);
  });
});

describe('categoriaECicloExistem', () => {
  // Achado Important R3 da revisão da Task 9: `itensDeTrocaDoCiclo` devolve
  // `[]` tanto para "ciclo existe, sem item de troca" quanto para "categoria
  // ou ciclo não existem" — e quem orquestra precisa saber QUAL dos dois
  // aconteceu pra não liberar a OS por causa de um id com typo.
  it('categoria e ciclo existentes: os dois true', () => {
    expect(categoriaECicloExistem(categorias, 'cat-filtros', 'c1'))
      .toEqual({ categoriaExiste: true, cicloExiste: true });
  });

  it('categoria existe, ciclo existe mas não tem linha de troca nenhuma: os dois true mesmo assim', () => {
    // O caso legítimo: ciclo só de inspeção. `categoriaECicloExistem` não
    // olha linha nenhuma — só se o ciclo está cadastrado.
    expect(categoriaECicloExistem(categorias, 'cat-filtros', 'c2'))
      .toEqual({ categoriaExiste: true, cicloExiste: true });
  });

  it('categoria existe, ciclo não existe: cicloExiste false', () => {
    expect(categoriaECicloExistem(categorias, 'cat-filtros', 'c-nao-existe'))
      .toEqual({ categoriaExiste: true, cicloExiste: false });
  });

  it('categoria não existe: os dois false (não dá pra saber do ciclo sem achar a categoria antes)', () => {
    expect(categoriaECicloExistem(categorias, 'cat-nao-existe', 'c1'))
      .toEqual({ categoriaExiste: false, cicloExiste: false });
  });

  it('categorias que não são array: os dois false', () => {
    expect(categoriaECicloExistem(null, 'cat-filtros', 'c1'))
      .toEqual({ categoriaExiste: false, cicloExiste: false });
  });
});

describe('parseQuantidade', () => {
  it('número puro', () => {
    expect(parseQuantidade('1')).toEqual({ valor: 1, unidade: null });
  });

  it('número colado na unidade', () => {
    expect(parseQuantidade('15L')).toEqual({ valor: 15, unidade: 'L' });
  });

  it('número com vírgula decimal, como se escreve em português', () => {
    expect(parseQuantidade('2,5 L')).toEqual({ valor: 2.5, unidade: 'L' });
  });

  it('vazio vale 1: o plano omite a quantidade quando é uma peça só', () => {
    expect(parseQuantidade('')).toEqual({ valor: 1, unidade: null });
    expect(parseQuantidade(undefined)).toEqual({ valor: 1, unidade: null });
  });

  it('texto sem número vale 1 e guarda a unidade', () => {
    expect(parseQuantidade('conforme manual')).toEqual({
      valor: 1,
      unidade: 'conforme manual',
    });
  });
});

describe('resolverPeca', () => {
  const catalogo = [
    { id: 'p-1', codigoInterno: 'ALM-000001', codigoFabricante: '32925682' },
    { id: 'p-2', codigoInterno: 'ALM-000002', codigoFabricante: 'CQM20136' },
    { id: 'p-3', codigoInterno: 'ALM-000003', codigoFabricante: 'CQM20136' },
  ];

  it('pecaId explícito vence o casamento por código', () => {
    expect(resolverPeca({ pecaId: 'p-9', codigoPeca: '32925682' }, catalogo)).toBe('p-9');
  });

  it('sem pecaId, casa pelo código do fabricante', () => {
    expect(resolverPeca({ codigoPeca: '32925682' }, catalogo)).toBe('p-1');
  });

  it('casa também pelo código interno', () => {
    expect(resolverPeca({ codigoPeca: 'ALM-000002' }, catalogo)).toBe('p-2');
  });

  it('código ambíguo NÃO resolve — duas peças com o mesmo part number', () => {
    // Escolher a primeira entregaria a marca errada em silêncio. Melhor a
    // tela dizer "não vinculado" e alguém decidir.
    expect(resolverPeca({ codigoPeca: 'CQM20136' }, catalogo)).toBeNull();
  });

  it('sem código nenhum não resolve', () => {
    expect(resolverPeca({}, catalogo)).toBeNull();
  });
});
