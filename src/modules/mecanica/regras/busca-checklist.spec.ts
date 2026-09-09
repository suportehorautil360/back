import {
  casaComEquipamento,
  interpretarBusca,
  ordenarResultado,
} from './busca-checklist';

describe('interpretarBusca', () => {
  it('só dígitos vira busca por código', () => {
    expect(interpretarBusca('57')).toEqual({ tipo: 'codigo', prefixo: '57' });
    expect(interpretarBusca('5')).toEqual({ tipo: 'codigo', prefixo: '5' });
  });

  it('qualquer letra vira busca por texto', () => {
    // "5 ton" é nome de máquina, não código.
    expect(interpretarBusca('estei')).toEqual({ tipo: 'texto', termo: 'estei' });
    expect(interpretarBusca('5 ton')).toEqual({ tipo: 'texto', termo: '5 ton' });
  });

  it('vazio e espaço em branco não buscam nada', () => {
    expect(interpretarBusca('')).toEqual({ tipo: 'vazia' });
    expect(interpretarBusca('   ')).toEqual({ tipo: 'vazia' });
    expect(interpretarBusca(undefined)).toEqual({ tipo: 'vazia' });
  });
});

describe('ordenarResultado', () => {
  const itens = [{ codigo: 570 }, { codigo: 5 }, { codigo: 57 }];

  it('código exato vem primeiro', () => {
    // Quem digita "57" inteiro quer o 57, não o 570.
    const r = ordenarResultado(itens, { tipo: 'codigo', prefixo: '57' });
    expect(r[0].codigo).toBe(57);
  });

  it('sem exato, ordena por código', () => {
    const r = ordenarResultado(itens, { tipo: 'texto', termo: 'x' });
    expect(r.map((i) => i.codigo)).toEqual([5, 57, 570]);
  });
});

describe('casaComEquipamento', () => {
  const escavadeira = { descricao: 'ESC-014', modelo: 'Escavadeira de esteira', tipo: null };

  it('casa por palavra-chave no modelo', () => {
    expect(casaComEquipamento(['esteira'], escavadeira)).toBe(true);
  });

  it('sem palavra-chave, vale para qualquer máquina', () => {
    // É o padrão de quem cadastra um checklist genérico.
    expect(casaComEquipamento([], escavadeira)).toBe(true);
    expect(casaComEquipamento(null, escavadeira)).toBe(true);
  });

  it('não casa quando nenhuma palavra bate', () => {
    expect(casaComEquipamento(['caminhão'], escavadeira)).toBe(false);
  });

  it('ignora caixa e espaço em volta', () => {
    expect(casaComEquipamento(['  ESTEIRA '], escavadeira)).toBe(true);
  });

  it('equipamento sem nenhum texto não casa palavra-chave nenhuma', () => {
    expect(casaComEquipamento(['esteira'], { descricao: null, modelo: null })).toBe(false);
  });
});
