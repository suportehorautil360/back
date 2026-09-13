/**
 * As regras da compra. Módulo puro: sem Prisma, sem Nest.
 *
 * Tudo que decide dinheiro ou quantidade de peça é contado em INTEIROS —
 * milésimos para quantidade (a coluna é `NUMERIC(12,3)`), centavos para valor
 * da ordem de compra — e só volta a `number` na saída. Em ponto flutuante,
 * `0.1 + 0.2` não é `0.3`, e uma cobertura de 0,3 L "menor" que uma falta de
 * 0,3 L deixaria uma OS em `aguardando_compra` com a peça já comprada.
 *
 * Cobertura é DERIVADA, nunca gravada (mesma postura de `disponivel` em
 * `disponibilidade.ts`): duas fontes para o mesmo número divergem no primeiro
 * bug.
 */
import type { StatusMateriais } from './status-materiais';

export const STATUS_ORDEM_COMPRA = [
  'rascunho',
  'aguardando_aprovacao',
  'emitida',
  'enviada',
  'recebida_parcial',
  'recebida',
  'encerrada',
  'cancelada',
] as const;
export type StatusOrdemCompra = (typeof STATUS_ORDEM_COMPRA)[number];

/** Na ordem do §8 do desenho: quem chega primeiro na fila da peça. */
export const PRIORIDADES = ['critica', 'alta', 'normal', 'reposicao'] as const;
export type Prioridade = (typeof PRIORIDADES)[number];

/** Rascunho e aguardando aprovação: ainda é cotação — não é compra. */
const EM_COTACAO = new Set<string>(['rascunho', 'aguardando_aprovacao']);
/** Emitida e ainda com algo por chegar. */
const EMITIDA_ABERTA = new Set<string>(['emitida', 'enviada', 'recebida_parcial']);
/** Onde pode ter entrado peça (recebimento só roda em OC emitida). */
const PODE_TER_RECEBIDO = new Set<string>(['emitida', 'enviada', 'recebida_parcial', 'recebida', 'encerrada']);

function milesimos(n: number): number {
  return Math.round(n * 1000);
}

function deMilesimos(n: number): number {
  return n / 1000;
}

/**
 * A falta de um item de requisição: o que a compra tem de cobrir.
 *
 * Só existe em item `faltante` — ele nunca é conferido, então nunca tem nada
 * separado nem entregue, e a falta é `solicitada − reservada`. Desde a
 * fundação da F4 a entrega não devolve mais a reserva parcial de um faltante,
 * então este número só DIMINUI depois que o item nasce (recebimento que
 * reserva, cancelamento que o tira de cena).
 */
export function faltaDoItem(item: {
  status: string;
  quantidadeSolicitada: number;
  quantidadeReservada: number;
}): number {
  if (item.status !== 'faltante') return 0;
  return deMilesimos(Math.max(0, milesimos(item.quantidadeSolicitada) - milesimos(item.quantidadeReservada)));
}

/** Uma origem de ordem de compra (item de OC ↔ item de SC), como a cobertura a vê. */
export interface OrigemParaCobertura {
  statusOrdemCompra: string;
  quantidade: number;
  quantidadeRecebida: number;
}

export interface Cobertura {
  /** Em OC `rascunho`/`aguardando_aprovacao`: cotado, não comprado. */
  emCotacao: number;
  /** Em OC emitida e ainda por chegar (pedido − recebido). */
  aCaminho: number;
  /** O que já chegou por estas origens. */
  recebido: number;
}

/**
 * Quanto de uma necessidade está em cotação, a caminho e já recebido.
 *
 * Quem chama passa só as origens de itens de solicitação VIVOS (não
 * cancelados). OC `encerrada` conta só o que recebeu — o resto não vem; OC
 * `cancelada` não conta nada.
 */
export function cobertura(origens: OrigemParaCobertura[]): Cobertura {
  let emCotacao = 0;
  let aCaminho = 0;
  let recebido = 0;
  for (const o of origens) {
    if (EM_COTACAO.has(o.statusOrdemCompra)) emCotacao += milesimos(o.quantidade);
    if (EMITIDA_ABERTA.has(o.statusOrdemCompra)) {
      aCaminho += Math.max(0, milesimos(o.quantidade) - milesimos(o.quantidadeRecebida));
    }
    if (PODE_TER_RECEBIDO.has(o.statusOrdemCompra)) recebido += milesimos(o.quantidadeRecebida);
  }
  return { emCotacao: deMilesimos(emCotacao), aCaminho: deMilesimos(aCaminho), recebido: deMilesimos(recebido) };
}

export interface FaltaComCobertura {
  falta: number;
  cobertura: Cobertura;
  /** O item é peça pedida com a OS em andamento (`origem = 'peca_adicional'`). */
  adicional: boolean;
}

/**
 * Os estados da OS em que o andamento da compra decide o `statusMateriais` —
 * os que `statusMateriaisComCompra` produz. Quem recalcula a OS depois de um
 * ato de compra só mexe numa OS que está num deles.
 */
export const ESTADOS_DE_COMPRA: ReadonlySet<string> = new Set([
  'aguardando_compra',
  'aguardando_peca_adicional',
  'compra_em_andamento',
  'recebimento_parcial',
]);

/**
 * Refina `aguardando_compra` pelo andamento da compra.
 *
 * As funções de `status-materiais.ts` continuam decidindo a máquina — esta só
 * olha o caso em que elas dizem "falta material":
 * - alguma falta SEM ordem de compra emitida cobrindo-a → `aguardando_compra`
 *   (cotação não é compra: rascunho e aguardando aprovação não contam) — ou
 *   `aguardando_peca_adicional` quando TODAS as faltas descobertas são de peça
 *   adicional (a OS já andou e espera a peça que o mecânico pediu, §5);
 * - toda falta coberta, e alguma já recebeu parte → `recebimento_parcial`;
 * - toda falta coberta, nada recebido ainda → `compra_em_andamento`.
 *
 * Qualquer outro `base` volta intacto — inclusive `em_analise_materiais`, em
 * que o item nem sabe que peça é e não há o que comprar.
 */
export function statusMateriaisComCompra(
  base: StatusMateriais,
  faltas: FaltaComCobertura[],
): StatusMateriais {
  if (base !== 'aguardando_compra') return base;
  const vivas = faltas.filter((f) => milesimos(f.falta) > 0);
  // Base diz que falta material, mas nenhuma falta com número: não há o que
  // refinar — fica o que a máquina decidiu.
  if (vivas.length === 0) return base;
  const descobertas = vivas.filter((f) => milesimos(f.cobertura.aCaminho) < milesimos(f.falta));
  if (descobertas.length > 0) {
    return descobertas.every((f) => f.adicional) ? 'aguardando_peca_adicional' : 'aguardando_compra';
  }
  if (vivas.some((f) => milesimos(f.cobertura.recebido) > 0)) return 'recebimento_parcial';
  return 'compra_em_andamento';
}

/**
 * Valor total da ordem de compra, em reais com duas casas.
 *
 * Quantidade (milésimos) × valor unitário (décimos de milésimo) em `BigInt` —
 * o produto passa do inteiro seguro do JavaScript com valores reais de peça —
 * e arredondado meio-para-cima nos centavos.
 */
export function valorTotalDaOrdem(itens: Array<{ quantidade: number; valorUnit: number }>): number {
  let total = 0n; // em 1e-7 reais
  for (const i of itens) {
    total += BigInt(Math.round(i.quantidade * 1000)) * BigInt(Math.round(i.valorUnit * 10000));
  }
  const centavos = (total + 50000n) / 100000n;
  return Number(centavos) / 100;
}

/**
 * A ordem de compra precisa de aprovação?
 *
 * Limite NULO = empresa sem limite configurado = TODA ordem pede aprovação —
 * falha para o lado seguro, decisão do dono do produto. Com limite, só o que
 * passa DELE (igual ao limite não pede).
 */
export function exigeAprovacao(valorTotal: number, limite: number | null): boolean {
  if (limite === null) return true;
  return Math.round(valorTotal * 100) > Math.round(limite * 100);
}

/**
 * Quem pode aprovar (ou devolver) uma ordem de compra acima do limite:
 * OWNER/ADMIN da conta e o gestor master configurado. Gestor master NULO vale
 * o OWNER — que já está coberto pelo papel.
 */
export function podeAprovarOrdemDeCompra(
  usuario: { role: string; companyUserId: string },
  gestorMasterCompanyUserId: string | null,
): boolean {
  if (usuario.role === 'OWNER' || usuario.role === 'ADMIN') return true;
  return gestorMasterCompanyUserId !== null && usuario.companyUserId === gestorMasterCompanyUserId;
}

export type AcaoOrdemCompra =
  | 'editar'
  | 'confirmar'
  | 'aprovar'
  | 'devolver'
  | 'enviar'
  | 'receber'
  | 'cancelar'
  | 'encerrar';

/**
 * De que estados cada ato parte. `cancelar` não alcança nada que tenha
 * recebido peça (emitida e enviada ainda não receberam — o recebimento leva a
 * `recebida_parcial`); `encerrar` é justamente o fim de uma OC que recebeu
 * parte e não vai receber o resto.
 */
const ACOES_PERMITIDAS: Record<AcaoOrdemCompra, ReadonlySet<string>> = {
  editar: new Set(['rascunho']),
  confirmar: new Set(['rascunho']),
  aprovar: new Set(['aguardando_aprovacao']),
  devolver: new Set(['aguardando_aprovacao']),
  enviar: new Set(['emitida']),
  receber: new Set(['emitida', 'enviada', 'recebida_parcial']),
  cancelar: new Set(['rascunho', 'aguardando_aprovacao', 'emitida', 'enviada']),
  encerrar: new Set(['recebida_parcial']),
};

export function acaoPermitida(status: string, acao: AcaoOrdemCompra): boolean {
  return ACOES_PERMITIDAS[acao].has(status);
}

/** Depois de um recebimento: tudo chegou, ou ainda falta. */
export function statusDaOrdemAposRecebimento(
  itens: Array<{ quantidade: number; quantidadeRecebida: number }>,
): 'recebida' | 'recebida_parcial' {
  return itens.every((i) => milesimos(i.quantidadeRecebida) >= milesimos(i.quantidade))
    ? 'recebida'
    : 'recebida_parcial';
}

export interface SituacaoDoItemDeSolicitacao {
  /** Em OC emitida (inteira) ou encerrada (só o recebido). */
  comprado: number;
  /** Em OC em rascunho ou aguardando aprovação. */
  emCotacao: number;
  recebido: number;
  /** O que ainda pode ir para uma OC nova. */
  disponivelParaCotar: number;
}

/**
 * Onde está cada unidade de um item de solicitação de compra.
 *
 * OC `encerrada` devolve o que não chegou: conta como comprado só o recebido,
 * e o resto volta a `disponivelParaCotar` — é assim que a falta volta a ser
 * cotável sem nascer outra solicitação.
 */
export function situacaoDoItemDeSolicitacao(
  quantidade: number,
  origens: OrigemParaCobertura[],
): SituacaoDoItemDeSolicitacao {
  let comprado = 0;
  let emCotacao = 0;
  let recebido = 0;
  for (const o of origens) {
    if (EM_COTACAO.has(o.statusOrdemCompra)) emCotacao += milesimos(o.quantidade);
    else if (o.statusOrdemCompra === 'encerrada') comprado += milesimos(o.quantidadeRecebida);
    else if (EMITIDA_ABERTA.has(o.statusOrdemCompra) || o.statusOrdemCompra === 'recebida') {
      comprado += milesimos(o.quantidade);
    }
    if (PODE_TER_RECEBIDO.has(o.statusOrdemCompra)) recebido += milesimos(o.quantidadeRecebida);
  }
  return {
    comprado: deMilesimos(comprado),
    emCotacao: deMilesimos(emCotacao),
    recebido: deMilesimos(recebido),
    disponivelParaCotar: deMilesimos(Math.max(0, milesimos(quantidade) - comprado - emCotacao)),
  };
}

/**
 * O status do CABEÇALHO da solicitação, a partir dos itens.
 *
 * `rejeitada` e `cancelada` são atos explícitos, com motivo — nunca derivados;
 * se o atual é um deles, fica. Entre os itens vivos: tudo comprado (ou já
 * atendido) → `aprovada`; alguma unidade em cotação ou comprada →
 * `em_cotacao`; nada andou → `pendente`.
 */
export function statusDaSolicitacao(
  atual: string,
  itens: Array<{ status: string; quantidade: number; comprado: number; emCotacao: number }>,
): string {
  if (atual === 'rejeitada' || atual === 'cancelada') return atual;
  const vivos = itens.filter((i) => i.status !== 'cancelada');
  if (vivos.length === 0) return atual;
  if (vivos.every((i) => i.status === 'atendida' || milesimos(i.comprado) >= milesimos(i.quantidade))) {
    return 'aprovada';
  }
  if (vivos.some((i) => milesimos(i.emCotacao) > 0 || milesimos(i.comprado) > 0)) return 'em_cotacao';
  return 'pendente';
}

/** Quem espera peça, com o que decide a ordem da fila (§8). */
export interface LugarNaFila {
  id: string;
  prioridade: string;
  dataNecessidade: Date | null;
  /** Quando a necessidade nasceu — o desempate "quem pediu antes". */
  pedidoEm: Date;
}

export interface OrigemParaDistribuir extends LugarNaFila {
  /** `quantidade − quantidadeRecebida` da origem. */
  pendente: number;
  /** A falta que esta origem cobre; nulo = reposição. */
  requisicaoItemId: string | null;
}

export interface FaltaParaDistribuir extends LugarNaFila {
  requisicaoItemId: string;
}

export interface Distribuicao {
  /** Quanto do recebido conta para cada origem (a OC entregou isso a ela). */
  porOrigem: Array<{ origemId: string; recebido: number }>;
  /** Quanto reservar para cada item de requisição. */
  reservas: Array<{ requisicaoItemId: string; quantidade: number }>;
  /** O que fica livre na prateleira. */
  livre: number;
}

const RANK_PRIORIDADE: Record<string, number> = { critica: 0, alta: 1, normal: 2, reposicao: 3 };

/** A ordem do §8: prioridade, depois data da necessidade, depois quem pediu antes. */
export function compararLugarNaFila(a: LugarNaFila, b: LugarNaFila): number {
  const pa = RANK_PRIORIDADE[a.prioridade] ?? 99;
  const pb = RANK_PRIORIDADE[b.prioridade] ?? 99;
  if (pa !== pb) return pa - pb;
  const da = a.dataNecessidade?.getTime() ?? Number.POSITIVE_INFINITY;
  const db = b.dataNecessidade?.getTime() ?? Number.POSITIVE_INFINITY;
  if (da !== db) return da < db ? -1 : 1;
  const ta = a.pedidoEm.getTime();
  const tb = b.pedidoEm.getTime();
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Para quem vai a peça que chegou — decisão do dono do produto: primeiro quem
 * PEDIU (as origens desta linha da OC, na ordem do §8), depois quem PRECISA
 * (outras faltas da mesma peça no mesmo depósito, na mesma ordem). Máquina
 * parada não espera a própria compra se a de outra OS já chegou; a compra
 * dela, quando chegar, vira estoque livre.
 *
 * Fase 1 — cada origem recebe até o seu pendente (é o que a OC entregou a ela)
 * e reserva até a falta ATUAL do item de requisição dela; o que a origem
 * recebe além da falta (reposição, falta já coberta, requisição cancelada)
 * fica livre.
 * Fase 2 — o livre atende as outras faltas até acabar.
 *
 * `faltaAtual` é a falta viva de cada item de requisição, relida com a
 * requisição travada; zero (ou ausente) = não reserva mais nada.
 *
 * Receber mais do que o pendente das origens é erro de quem chamou — lança em
 * vez de inventar para onde vai a sobra.
 */
export function distribuirRecebimento(input: {
  quantidade: number;
  origens: OrigemParaDistribuir[];
  faltaAtual: Record<string, number>;
  outrasFaltas: FaltaParaDistribuir[];
}): Distribuicao {
  let restante = milesimos(input.quantidade);
  const faltas = new Map<string, number>(
    Object.entries(input.faltaAtual).map(([id, f]) => [id, Math.max(0, milesimos(f))]),
  );
  const reservas = new Map<string, number>();
  const porOrigem: Array<{ origemId: string; recebido: number }> = [];
  let livre = 0;

  const reservar = (requisicaoItemId: string, ate: number): number => {
    const falta = faltas.get(requisicaoItemId) ?? 0;
    const r = Math.min(ate, falta);
    if (r > 0) {
      faltas.set(requisicaoItemId, falta - r);
      reservas.set(requisicaoItemId, (reservas.get(requisicaoItemId) ?? 0) + r);
    }
    return r;
  };

  for (const o of [...input.origens].sort(compararLugarNaFila)) {
    if (restante === 0) break;
    const alocar = Math.min(restante, Math.max(0, milesimos(o.pendente)));
    if (alocar === 0) continue;
    porOrigem.push({ origemId: o.id, recebido: deMilesimos(alocar) });
    restante -= alocar;
    const reservado = o.requisicaoItemId ? reservar(o.requisicaoItemId, alocar) : 0;
    livre += alocar - reservado;
  }
  if (restante > 0) {
    throw new RangeError(
      `Recebido acima do pendente das origens em ${deMilesimos(restante)} — confira a quantidade antes de distribuir.`,
    );
  }

  for (const f of [...input.outrasFaltas].sort(compararLugarNaFila)) {
    if (livre === 0) break;
    livre -= reservar(f.requisicaoItemId, livre);
  }

  return {
    porOrigem,
    reservas: [...reservas.entries()].map(([requisicaoItemId, q]) => ({
      requisicaoItemId,
      quantidade: deMilesimos(q),
    })),
    livre: deMilesimos(livre),
  };
}
