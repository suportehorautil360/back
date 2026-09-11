/**
 * A matriz preventiva virando o documento que o mecânico preenche.
 *
 * Quem abre uma O.S. preventiva no painel escolhe categoria e ciclo do plano,
 * e o relato da ordem nasce com as linhas daquele ciclo — texto corrido, para
 * ler. Ler não é registrar: o mecânico passava item por item na máquina e não
 * tinha onde marcar o que estava conforme, o que não estava e o que não se
 * aplicava àquele equipamento. O que ele fez sumia, e a preventiva ficava
 * provada por uma frase no laudo.
 *
 * Estas funções traduzem categoria + ciclo nos GRUPOS e ITENS de um modelo de
 * checklist — o mesmo formato que a inspeção comum já usa (`ChecklistModelo.
 * grupos`), para a tela do app não precisar saber de onde o documento veio.
 *
 * Puras: sem Prisma e sem Nest. A matriz chega como veio do Json, e a
 * desconfiança com o formato mora aqui — `PlanoPreventivo.categorias` é uma
 * coluna Json, editada por import de PDF, e o banco não garante nada.
 */

/**
 * Preventiva é `V`. `P` é PREDITIVA — a troca entre as duas já custou um
 * bloco de tela que nunca aparecia, e a letra fica nomeada aqui para ninguém
 * mais decidir de memória.
 */
export const TIPO_OS_PREVENTIVA = 'V';

/**
 * O plano que vale quando o modelo da máquina não tem o seu.
 *
 * Mesmo nome que o painel grava (`MODELO_GERAL` em
 * `horautil/lib/company/plano-preventivo.ts`): os dois leem a MESMA linha, e
 * um "geral" de um lado com "Geral" do outro faria o app não achar o plano
 * que o painel mostra na tela.
 */
export const PLANO_MODELO_GERAL = 'Geral';

/**
 * As ações da matriz, incluindo as duas que o painel acrescentou depois
 * (`drenar`, `verificar_ajustar`) e que o tipo antigo do back não conhece.
 *
 * A lista existe para o rótulo, não para validar: ação desconhecida vira item
 * assim mesmo, com o texto cru. Um plano importado com uma ação que este
 * arquivo nunca viu tem de aparecer para o mecânico — sumir em silêncio é o
 * único desfecho que não tem conserto na máquina.
 */
const INSTRUCAO: Record<string, string> = {
  inspecionar: 'Inspecionar',
  trocar: 'Trocar',
  limpar: 'Limpar',
  lubrificar: 'Lubrificar',
  coletar: 'Coletar amostra',
  drenar: 'Drenar',
  verificar_ajustar: 'Verificar e ajustar',
  medir_trocar: 'Medir e trocar',
  se_necessario: 'Fazer se necessário',
  opcional: 'Opcional',
};

/** "Não se aplica" naquele ciclo — a única ação que NÃO vira item. */
const SEM_TRABALHO = 'na';

export interface LinhaDaMatriz {
  id?: string;
  item?: string;
  especificacao?: string;
  codigoPeca?: string;
  quantidade?: string;
  acoes?: Record<string, string>;
}

export interface CicloDaMatriz {
  id?: string;
  titulo?: string;
  horas?: number;
  km?: number;
}

export interface CategoriaDaMatriz {
  id?: string;
  nome?: string;
  ciclos?: CicloDaMatriz[];
  linhas?: LinhaDaMatriz[];
}

export interface ItemGerado {
  id: string;
  numero: number;
  descricao: string;
  /**
   * Nenhum item nasce obrigatório. A matriz do fabricante cobre a máquina
   * inteira e o ciclo traz linha que o equipamento não tem — travar a
   * conclusão por causa delas ensinaria o mecânico a marcar "conforme" no que
   * não olhou, que é pior que o campo em branco. É para isso que existe o
   * "N/A" na tela.
   */
  obrigatorio: boolean;
  foto: 'nao' | 'se_nao_conforme' | 'sempre';
}

export interface GrupoGerado {
  id: string;
  codigo: number;
  nome: string;
  itens: ItemGerado[];
}

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

function lerArray<T>(valor: unknown): T[] {
  return Array.isArray(valor) ? (valor as T[]) : [];
}

/**
 * A linha da matriz escrita como instrução.
 *
 * "Trocar — Filtro de óleo do motor (Cartucho spin-on) [1 · 32925682]": a
 * ação na frente porque é ela que diz o que fazer, e o código da peça junto
 * porque quem está com a mão na máquina precisa dele para pedir no
 * almoxarifado sem voltar à tela do plano.
 */
export function descricaoDaLinha(linha: LinhaDaMatriz, acao: string): string {
  const item = texto(linha.item) || 'Item sem descrição';
  const instrucao = INSTRUCAO[acao] ?? acao;
  const partes = [`${instrucao} — ${item}`];

  // A especificação só entra quando acrescenta: no plano de fabricante ela às
  // vezes repete o item, e "Trocar — Filtro de ar (Filtro de ar)" é ruído.
  const espec = texto(linha.especificacao);
  if (espec && espec.toLowerCase() !== item.toLowerCase()) {
    partes.push(`(${espec})`);
  }

  const qtd = texto(linha.quantidade);
  const cod = texto(linha.codigoPeca);
  if (qtd || cod) partes.push(`[${[qtd, cod].filter(Boolean).join(' · ')}]`);

  return partes.join(' ');
}

/**
 * Os grupos de um ciclo, prontos para virar `ChecklistModelo.grupos`.
 *
 * Recorta por categoria E por ciclo: a O.S. preventiva guarda os dois
 * (`categoriaPlanoId`, `cicloId`), e é esse par que o mecânico vai executar —
 * trazer o plano inteiro devolveria um documento de duzentas linhas para uma
 * revisão de dez.
 *
 * Cada CATEGORIA vira um grupo. Hoje o recorte é de uma só, e o resultado tem
 * um grupo apenas; a forma é plural porque é a que a tela já sabe percorrer, e
 * porque o dia que um ciclo cruzar categorias nada aqui muda.
 */
export function gerarGrupos(
  categorias: unknown,
  categoriaId: string,
  cicloId: string,
): GrupoGerado[] {
  const cats = lerArray<CategoriaDaMatriz>(categorias);
  const categoria = cats.find((c) => texto(c.id) === categoriaId.trim());
  if (!categoria) return [];

  const ciclo = lerArray<CicloDaMatriz>(categoria.ciclos).find(
    (c) => texto(c.id) === cicloId.trim(),
  );
  if (!ciclo) return [];

  const chaveDoCiclo = texto(ciclo.id);
  const itens: ItemGerado[] = [];

  for (const linha of lerArray<LinhaDaMatriz>(categoria.linhas)) {
    const acao = texto(linha.acoes?.[chaveDoCiclo]);
    // Sem ação e "na" são a mesma coisa: a linha não é trabalho deste ciclo.
    if (!acao || acao === SEM_TRABALHO) continue;

    itens.push({
      // O id do item é o da LINHA do plano: é o que liga a resposta de volta
      // à matriz, e o que faz reabrir a mesma inspeção reencontrar o que já
      // foi respondido, mesmo que a ordem das linhas mude no plano.
      id: texto(linha.id) || `l${itens.length + 1}`,
      numero: itens.length + 1,
      descricao: descricaoDaLinha(linha, acao),
      obrigatorio: false,
      foto: 'se_nao_conforme',
    });
  }

  if (itens.length === 0) return [];

  return [
    {
      id: texto(categoria.id) || 'g1',
      codigo: 1,
      nome: texto(categoria.nome) || 'Preventiva',
      itens,
    },
  ];
}

/**
 * Como o documento se chama para quem abre: "PREVENTIVA CICLO 2 (500H /
 * 20.000KM) — ESCAVADEIRA".
 *
 * Sai do par categoria + ciclo porque é o par que identifica o documento. Dois
 * ciclos da mesma categoria são inspeções diferentes, e um nome que só citasse
 * a categoria deixaria o mecânico sem saber qual das duas está preenchendo.
 */
export function nomeDaInspecao(
  categorias: unknown,
  categoriaId: string,
  cicloId: string,
): string {
  const cats = lerArray<CategoriaDaMatriz>(categorias);
  const categoria = cats.find((c) => texto(c.id) === categoriaId.trim());
  const ciclo = lerArray<CicloDaMatriz>(categoria?.ciclos).find(
    (c) => texto(c.id) === cicloId.trim(),
  );

  const partes = [texto(ciclo?.titulo), texto(categoria?.nome)].filter(Boolean);
  return `PREVENTIVA ${partes.join(' — ')}`.trim().toUpperCase();
}
