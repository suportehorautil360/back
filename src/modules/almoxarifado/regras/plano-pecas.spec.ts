import {
  itensDeTrocaDoCiclo,
  parseQuantidade,
  resolverPeca,
} from './plano-pecas';

const categorias = [
  {
    id: 'cat-filtros',
    nome: 'Filtros',
    ciclos: [{ id: 'c1', titulo: 'Ciclo 1' }],
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
