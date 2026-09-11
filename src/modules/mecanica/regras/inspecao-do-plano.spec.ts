/**
 * O que se prende aqui é a tradução da matriz preventiva no documento que o
 * mecânico preenche — e, principalmente, o que ela NÃO pode perder pelo
 * caminho. `PlanoPreventivo.categorias` é uma coluna Json alimentada por
 * import de PDF: o formato não é garantido por nada, e uma linha que suma em
 * silêncio é uma revisão que ninguém faz na máquina.
 */
import {
  descricaoDaLinha,
  gerarGrupos,
  nomeDaInspecao,
} from './inspecao-do-plano';

const MATRIZ = [
  {
    id: 'cat-retro',
    nome: 'retro',
    ciclos: [
      { id: 'c1', titulo: 'Ciclo 1 (250h / 10.000km)', horas: 250, km: 10000 },
      { id: 'c2', titulo: 'Ciclo 2 (500h / 20.000km)', horas: 500, km: 20000 },
    ],
    linhas: [
      {
        id: 'l-oleo',
        item: 'Óleo do Motor',
        especificacao: 'SAE 15W-40 CI-4',
        codigoPeca: '32925682',
        quantidade: '1',
        acoes: { c1: 'trocar', c2: 'inspecionar' },
      },
      {
        id: 'l-correia',
        item: 'Correia de Acessórios',
        especificacao: 'Perfil V / Poly-V',
        acoes: { c1: 'na', c2: 'verificar_ajustar' },
      },
      {
        id: 'l-so-no-1',
        item: 'Filtro de Ar',
        especificacao: '',
        acoes: { c1: 'limpar' },
      },
    ],
  },
  {
    id: 'cat-escav',
    nome: 'escavadeira',
    ciclos: [{ id: 'e1', titulo: 'Ciclo 1 (250h)', horas: 250, km: 0 }],
    linhas: [
      { id: 'l-esteira', item: 'Esteira', acoes: { e1: 'inspecionar' } },
    ],
  },
];

describe('gerarGrupos', () => {
  it('traz só as linhas com trabalho NAQUELE ciclo', () => {
    const [grupo] = gerarGrupos(MATRIZ, 'cat-retro', 'c2');

    // `l-so-no-1` não tem ação em c2; `l-correia` tem "na" em c1 mas trabalho
    // em c2 — as duas provam que o recorte é por ciclo, não por categoria.
    expect(grupo.itens.map((i) => i.id)).toEqual(['l-oleo', 'l-correia']);
  });

  it('"na" não vira item — é a linha que não se aplica ao ciclo', () => {
    const [grupo] = gerarGrupos(MATRIZ, 'cat-retro', 'c1');
    expect(grupo.itens.map((i) => i.id)).toEqual(['l-oleo', 'l-so-no-1']);
  });

  it('não deixa vazar linha de OUTRA categoria', () => {
    const [grupo] = gerarGrupos(MATRIZ, 'cat-retro', 'c2');
    expect(grupo.itens.some((i) => i.id === 'l-esteira')).toBe(false);
  });

  it('a numeração é contínua, sem buraco de linha pulada', () => {
    const [grupo] = gerarGrupos(MATRIZ, 'cat-retro', 'c1');
    expect(grupo.itens.map((i) => i.numero)).toEqual([1, 2]);
  });

  /**
   * O id do item é o da LINHA do plano, não um contador: é ele que liga a
   * resposta de volta à matriz. Se fosse posicional, acrescentar uma linha no
   * plano remendaria as respostas já gravadas de uma inspeção aberta para o
   * item errado.
   */
  it('o id do item é o id da linha do plano', () => {
    const [grupo] = gerarGrupos(MATRIZ, 'cat-retro', 'c2');
    expect(grupo.itens[0].id).toBe('l-oleo');
  });

  /**
   * Travar a conclusão por item obrigatório ensinaria o mecânico a marcar
   * "conforme" no que não olhou: o ciclo do fabricante cobre a máquina
   * inteira e traz linha que aquele equipamento não tem. Para isso existe o
   * "N/A" na tela.
   */
  it('nenhum item nasce obrigatório', () => {
    const [grupo] = gerarGrupos(MATRIZ, 'cat-retro', 'c2');
    expect(grupo.itens.every((i) => i.obrigatorio === false)).toBe(true);
  });

  it('a categoria vira o grupo, com o nome dela', () => {
    const [grupo] = gerarGrupos(MATRIZ, 'cat-retro', 'c2');
    expect(grupo.nome).toBe('retro');
    expect(grupo.id).toBe('cat-retro');
  });

  it('ciclo sem nenhum trabalho não devolve grupo vazio', () => {
    const semTrabalho = [
      {
        id: 'c',
        nome: 'x',
        ciclos: [{ id: 'z', titulo: 'Z' }],
        linhas: [{ id: 'l', item: 'Item', acoes: { z: 'na' } }],
      },
    ];
    expect(gerarGrupos(semTrabalho, 'c', 'z')).toEqual([]);
  });

  it('categoria ou ciclo que não existem devolvem vazio, sem estourar', () => {
    expect(gerarGrupos(MATRIZ, 'nao-existe', 'c2')).toEqual([]);
    expect(gerarGrupos(MATRIZ, 'cat-retro', 'nao-existe')).toEqual([]);
  });

  // A coluna é Json: já chegou array, já chegou objeto, e pode chegar null.
  it('matriz que não é array devolve vazio, sem estourar', () => {
    expect(gerarGrupos(null, 'c', 'z')).toEqual([]);
    expect(gerarGrupos({ categorias: [] }, 'c', 'z')).toEqual([]);
    expect(gerarGrupos('lixo', 'c', 'z')).toEqual([]);
  });

  /**
   * O tipo do back conhece nove ações; o painel já acrescentou `drenar` e
   * `verificar_ajustar` depois, e vai acrescentar outras. Ação desconhecida
   * tem de virar item com o texto cru — sumir é o único desfecho sem conserto
   * na máquina.
   */
  it('ação que este arquivo não conhece ainda vira item', () => {
    const futuro = [
      {
        id: 'c',
        nome: 'x',
        ciclos: [{ id: 'z', titulo: 'Z' }],
        linhas: [{ id: 'l', item: 'Sensor', acoes: { z: 'calibrar' } }],
      },
    ];
    const [grupo] = gerarGrupos(futuro, 'c', 'z');
    expect(grupo.itens[0].descricao).toBe('calibrar — Sensor');
  });
});

describe('descricaoDaLinha', () => {
  it('põe a ação na frente do item', () => {
    expect(
      descricaoDaLinha({ item: 'Óleo do Motor' }, 'trocar'),
    ).toBe('Trocar — Óleo do Motor');
  });

  it('leva código e quantidade da peça, que é o que se pede no almoxarifado', () => {
    expect(
      descricaoDaLinha(
        { item: 'Filtro', especificacao: 'Spin-on', codigoPeca: '329', quantidade: '2' },
        'trocar',
      ),
    ).toBe('Trocar — Filtro (Spin-on) [2 · 329]');
  });

  // No plano de fabricante a especificação às vezes repete o item, e
  // "Trocar — Filtro de ar (Filtro de ar)" é ruído.
  it('não repete a especificação quando ela é o próprio item', () => {
    expect(
      descricaoDaLinha({ item: 'Filtro de ar', especificacao: 'FILTRO DE AR' }, 'limpar'),
    ).toBe('Limpar — Filtro de ar');
  });

  it('linha sem descrição não vira item anônimo na tela', () => {
    expect(descricaoDaLinha({}, 'inspecionar')).toBe(
      'Inspecionar — Item sem descrição',
    );
  });
});

describe('nomeDaInspecao', () => {
  // Dois ciclos da mesma categoria são documentos diferentes: um nome que só
  // citasse a categoria deixaria o mecânico sem saber qual está preenchendo.
  it('junta ciclo e categoria, que é o par que identifica o documento', () => {
    expect(nomeDaInspecao(MATRIZ, 'cat-retro', 'c2')).toBe(
      'PREVENTIVA CICLO 2 (500H / 20.000KM) — RETRO',
    );
  });

  it('sem achar o plano, ainda devolve um nome utilizável', () => {
    expect(nomeDaInspecao(null, 'x', 'y')).toBe('PREVENTIVA');
  });
});
