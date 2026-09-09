import {
  impeditivosReprovados,
  lerGrupos,
  lerRespostas,
  mesclarRespostasDoGrupo,
  pendenciaDoItem,
  pendencias,
  progressoDoGrupo,
  type GrupoDoModelo,
} from './checklist-execucao';

const item = (id: string, extras: Record<string, unknown> = {}) => ({
  id,
  numero: 1,
  descricao: `Item ${id}`,
  obrigatorio: true,
  foto: 'nao' as const,
  impeditivo: false,
  ...extras,
});

const GRUPO: GrupoDoModelo = {
  id: 'g1',
  codigo: 29,
  nome: 'VERIFICAÇÕES',
  itens: [
    item('a'),
    item('b', { foto: 'sempre' }),
    item('c', { foto: 'se_nao_conforme' }),
    item('d', { obrigatorio: false }),
  ],
};

describe('pendenciaDoItem', () => {
  it('obrigatório em branco trava — checklist com buraco não prova nada', () => {
    expect(pendenciaDoItem(item('a'), undefined)).toBe('sem_resposta');
  });

  it('não obrigatório em branco não trava', () => {
    expect(pendenciaDoItem(item('a', { obrigatorio: false }), undefined)).toBeNull();
  });

  it('não conforme sem observação trava', () => {
    // Um "não conforme" mudo não serve nem para o gestor decidir, nem para o
    // próximo mecânico.
    expect(pendenciaDoItem(item('a'), { valor: 'nao_conforme' })).toBe('sem_observacao');
    expect(
      pendenciaDoItem(item('a'), { valor: 'nao_conforme', observacao: 'Mangueira furada' }),
    ).toBeNull();
  });

  it('a regra da observação vale mesmo em item não obrigatório', () => {
    // Quem respondeu "não conforme" precisa dizer o que viu.
    expect(
      pendenciaDoItem(item('a', { obrigatorio: false }), { valor: 'nao_conforme' }),
    ).toBe('sem_observacao');
  });

  it('foto sempre exige foto, mesmo em item conforme', () => {
    expect(pendenciaDoItem(item('b', { foto: 'sempre' }), { valor: 'conforme' })).toBe(
      'sem_foto',
    );
    expect(
      pendenciaDoItem(item('b', { foto: 'sempre' }), { valor: 'conforme', fotos: ['u'] }),
    ).toBeNull();
  });

  it('foto se reprovar só cobra quando reprova', () => {
    const it = item('c', { foto: 'se_nao_conforme' });
    expect(pendenciaDoItem(it, { valor: 'conforme' })).toBeNull();
    expect(pendenciaDoItem(it, { valor: 'nao_conforme', observacao: 'x' })).toBe('sem_foto');
  });

  it('observação só de espaço não conta como observação', () => {
    expect(pendenciaDoItem(item('a'), { valor: 'nao_conforme', observacao: '   ' })).toBe(
      'sem_observacao',
    );
  });
});

describe('pendencias', () => {
  it('lista o que falta, com grupo e número — a tela precisa dizer onde', () => {
    const r = pendencias([GRUPO], { a: { valor: 'conforme' } });

    expect(r.map((p) => p.itemId)).toEqual(['b', 'c']);
    expect(r[0]).toMatchObject({ grupoNome: 'VERIFICAÇÕES', motivo: 'sem_resposta' });
  });

  it('vazio quando tudo está resolvido', () => {
    expect(
      pendencias([GRUPO], {
        a: { valor: 'conforme' },
        b: { valor: 'conforme', fotos: ['u'] },
        c: { valor: 'na' },
      }),
    ).toEqual([]);
  });
});

describe('impeditivosReprovados', () => {
  it('devolve os graves reprovados, sem travar a conclusão', () => {
    // O registro fiel do que foi encontrado é o produto; avarias de
    // desembarque podem ser quinze e todas legítimas.
    const grupo: GrupoDoModelo = {
      ...GRUPO,
      itens: [item('a', { impeditivo: true }), item('b', { impeditivo: false })],
    };

    const r = impeditivosReprovados([grupo], {
      a: { valor: 'nao_conforme', observacao: 'Freio sem pressão' },
      b: { valor: 'nao_conforme', observacao: 'Risco na pintura' },
    });

    expect(r.map((p) => p.itemId)).toEqual(['a']);
  });
});

describe('progressoDoGrupo', () => {
  it('conta os resolvidos, não os respondidos', () => {
    // Item com foto pendente foi respondido mas não está resolvido.
    const r = progressoDoGrupo(GRUPO, {
      a: { valor: 'conforme' },
      b: { valor: 'conforme' },
    });

    expect(r).toEqual({ resolvidos: 2, total: 4 });
  });
});

describe('mesclarRespostasDoGrupo', () => {
  it('preserva o que está fora do grupo', () => {
    // É o que faz o trabalho de terça sobreviver até quinta.
    const r = mesclarRespostasDoGrupo(
      { deOutroGrupo: { valor: 'conforme' } },
      GRUPO,
      { a: { valor: 'conforme' } },
    );

    expect(r.deOutroGrupo).toEqual({ valor: 'conforme' });
    expect(r.a).toEqual({ valor: 'conforme' });
  });

  it('descarta resposta de item que não é do grupo', () => {
    // Corpo malicioso ou bug de tela não escreve em outra seção.
    const r = mesclarRespostasDoGrupo({}, GRUPO, {
      a: { valor: 'conforme' },
      intruso: { valor: 'conforme' },
    });

    expect(r).toEqual({ a: { valor: 'conforme' } });
  });
});

describe('leitura do Json cru', () => {
  it('tolera formato inesperado — o banco não garante o shape', () => {
    expect(lerGrupos(null)).toEqual([]);
    expect(lerGrupos('lixo')).toEqual([]);
    expect(lerGrupos([{ semItens: true }])).toEqual([]);
    expect(lerRespostas(null)).toEqual({});
    expect(lerRespostas([1, 2])).toEqual({});
  });
});
