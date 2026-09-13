import { Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '../../../prisma/generated/client';
import { registrarAuditoriaSuprimentos } from '../auditoria';
import { proximoNumeroDocumento } from '../helpers/numero-documento.helper';
import { justificativaDaReposicao, posicaoDeEstoque, quantidadeDeReposicao } from '../regras/reposicao';
import { alvoDaViolacao, comRetryDeContencao } from '../transacao';

/**
 * Reposição automática por estoque mínimo (F4.2).
 *
 * Por (peça, depósito): peça ativa com mínimo > 0, depósito ativo, empresa com
 * `suprimentos` ligada, e só onde a peça já tem linha em `peca_saldos` — sem
 * linha, a peça não é estocada naquele depósito e não há o que repor. A
 * verificação nunca cria linha de saldo.
 *
 * Posição = disponível + reposição já pedida e ainda não recebida (itens de
 * solicitação sem ligação com OS, abertos, do mesmo depósito, de solicitação
 * não rejeitada nem cancelada). Olhar só o disponível abriria uma solicitação
 * nova a cada reserva enquanto a primeira compra não chega.
 *
 * Não avisa ninguém: a solicitação aparece na fila de Compras, em nome do
 * gestor master.
 */

const logger = new Logger('EstoqueMinimo');

const FEATURE_SUPRIMENTOS = 'suprimentos';

/**
 * Índice único parcial da migration `20260913160000_peca_adicional_e_reposicao`:
 * no máximo um item aberto com `deposito_reposicao_id` por (peça, depósito). Só
 * existe em SQL — Prisma não expressa índice com `WHERE`.
 */
export const INDICE_UMA_REPOSICAO_AUTOMATICA = 'solicitacao_compra_itens_uma_reposicao_automatica';

export interface AlvoDeReposicao {
  companyId: string;
  pecaId: string;
  depositoId: string;
}

export interface ReposicaoCriada {
  solicitacaoId: string;
  numero: string;
}

/**
 * Outra transação criou a reposição automática deste par entre a nossa
 * checagem e o INSERT. Não é erro nem contenção: o que se queria já existe, e
 * tentar de novo só acharia o item dela.
 */
function colisaoDeReposicaoAutomatica(erro: unknown): boolean {
  if (!(erro instanceof Prisma.PrismaClientKnownRequestError) || erro.code !== 'P2002') return false;
  const alvo = alvoDaViolacao(erro);
  return (
    alvo.includes(INDICE_UMA_REPOSICAO_AUTOMATICA) ||
    alvo.includes('deposito_reposicao_id') ||
    alvo.includes('depositoReposicaoId')
  );
}

/**
 * Em nome de quem a solicitação automática nasce: o gestor master se for
 * usuário ATIVO desta empresa (a coluna é UUID solto, a validação mora aqui);
 * senão o OWNER ativo mais antigo; senão ninguém.
 */
async function emNomeDaReposicao(tx: Prisma.TransactionClient, companyId: string): Promise<string | null> {
  const settings = await tx.companySettings.findUnique({
    where: { companyId },
    select: { gestorMasterCompanyUserId: true },
  });
  if (settings?.gestorMasterCompanyUserId) {
    const gestor = await tx.companyUser.findFirst({
      where: { id: settings.gestorMasterCompanyUserId, companyId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (gestor) return gestor.id;
  }
  const dono = await tx.companyUser.findFirst({
    where: { companyId, role: 'OWNER', status: 'ACTIVE' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });
  return dono?.id ?? null;
}

/**
 * O corpo da transação. Ordem de trava: só a linha de `peca_saldos` do par —
 * uma trava por transação, então não há ordem a disputar com as outras
 * escritas de saldo.
 */
async function executarVerificacao(
  tx: Prisma.TransactionClient,
  alvo: AlvoDeReposicao,
): Promise<ReposicaoCriada | null> {
  const { companyId, pecaId, depositoId } = alvo;

  // 1. Escopo que a trava não protege: módulo contratado e depósito ativo
  //    DESTA empresa. Um id de outra empresa sai aqui, antes de travar nada.
  const feature = await tx.companyFeature.findFirst({
    where: { companyId, enabled: true, feature: { key: FEATURE_SUPRIMENTOS } },
    select: { companyId: true },
  });
  if (!feature) return null;
  const deposito = await tx.deposito.findFirst({
    where: { id: depositoId, companyId, ativo: true },
    select: { id: true },
  });
  if (!deposito) return null;

  // 2. Trava a linha de saldo. Duas verificações do mesmo par ficam em fila
  //    aqui, e a segunda relê o item aberto que a primeira criou. Sem linha, a
  //    peça não é estocada neste depósito — e não se cria uma.
  const linhas = await tx.$queryRaw<{ peca_id: string }[]>(Prisma.sql`
    SELECT peca_id FROM peca_saldos
     WHERE peca_id = ${pecaId}::uuid
       AND deposito_id = ${depositoId}::uuid
       FOR UPDATE
  `);
  if (!linhas[0]) return null;

  // 3. Relê com a trava na mão: o saldo e o cadastro da peça.
  const saldo = await tx.pecaSaldo.findUniqueOrThrow({
    where: { pecaId_depositoId: { pecaId, depositoId } },
    select: { saldoFisico: true, saldoReservado: true },
  });
  const peca = await tx.peca.findFirst({
    where: { id: pecaId, companyId },
    select: { codigoInterno: true, ativo: true, estoqueMinimo: true, loteReposicao: true },
  });
  if (!peca) return null;

  // 4. Já existe reposição automática aberta deste par: não cria outra, mesmo
  //    que o lote dela não baste para voltar ao mínimo. O índice único parcial
  //    é a rede se esta checagem perder uma corrida.
  const jaAberta = await tx.solicitacaoCompraItem.findFirst({
    where: { pecaId, depositoReposicaoId: depositoId, status: 'aberta', solicitacao: { companyId } },
    select: { id: true },
  });
  if (jaAberta) return null;

  // 5. Posição: disponível + reposição pedida e ainda não recebida. Item com
  //    `requisicaoItemId` vai para uma OS, não para a prateleira.
  const pendentes = await tx.solicitacaoCompraItem.findMany({
    where: {
      pecaId,
      requisicaoItemId: null,
      status: 'aberta',
      solicitacao: { companyId, depositoId, status: { notIn: ['rejeitada', 'cancelada'] } },
    },
    select: { quantidade: true, origensOc: { select: { quantidadeRecebida: true } } },
  });
  const posicao = posicaoDeEstoque(
    { saldoFisico: Number(saldo.saldoFisico), saldoReservado: Number(saldo.saldoReservado) },
    pendentes.map((p) => ({
      quantidade: Number(p.quantidade),
      recebidoPorOrigem: p.origensOc.map((o) => Number(o.quantidadeRecebida)),
    })),
  );
  const minimo = Number(peca.estoqueMinimo);
  const quantidade = quantidadeDeReposicao(
    { ativo: peca.ativo, estoqueMinimo: minimo, loteReposicao: Number(peca.loteReposicao) },
    posicao.posicao,
  );
  if (quantidade <= 0) return null;

  // 6. A solicitação. Número MAX+1 por empresa, como a da falta: o unique de
  //    `(company_id, numero)` detecta a colisão e o retry de quem chamou refaz.
  const emNomeDeCompanyUserId = await emNomeDaReposicao(tx, companyId);
  const ano = new Date().getUTCFullYear();
  const existentes = await tx.solicitacaoCompra.findMany({
    where: { companyId, numero: { startsWith: `SC-${ano}-` } },
    select: { numero: true },
  });
  const numero = proximoNumeroDocumento('SC', ano, existentes.map((e) => e.numero));

  const sc = await tx.solicitacaoCompra.create({
    data: {
      companyId,
      numero,
      origem: 'estoque_minimo',
      prioridade: 'reposicao',
      depositoId,
      serviceOrderId: null,
      requisicaoId: null,
      justificativa: justificativaDaReposicao(posicao, minimo),
      solicitanteCompanyUserId: null,
      emNomeDeCompanyUserId,
      itens: {
        create: [
          {
            pecaId,
            quantidade,
            prioridade: 'reposicao',
            requisicaoItemId: null,
            depositoReposicaoId: depositoId,
          },
        ],
      },
    },
    select: { id: true, numero: true },
  });

  // 7. Rastro — parte do ato. Ator nulo: foi o sistema.
  await registrarAuditoriaSuprimentos(tx, {
    companyId,
    acao: 'solicitacao_compra.criar_automatica',
    alvoTipo: 'suprimentos.solicitacao_compra',
    alvoId: sc.id,
    atorCompanyUserId: null,
    depois: {
      numero: sc.numero,
      pecaId,
      codigoInterno: peca.codigoInterno,
      depositoId,
      disponivel: posicao.disponivel,
      aCaminho: posicao.aCaminho,
      posicao: posicao.posicao,
      minimo,
      quantidade,
      emNomeDeCompanyUserId,
    },
  });

  return { solicitacaoId: sc.id, numero: sc.numero };
}

/**
 * Verifica um par (peça, depósito) e abre a solicitação automática se a
 * posição estiver abaixo do mínimo. Transação própria, refeita por contenção.
 *
 * Devolve nulo quando não criou — fora de escopo, acima do mínimo, ou já
 * existe a automática aberta (inclusive quando outra transação a criou no
 * meio desta). Lança nos outros erros; quem não pode falhar chama
 * `verificarReposicoesSemFalhar`.
 */
export async function verificarReposicao(
  prisma: PrismaClient,
  alvo: AlvoDeReposicao,
): Promise<ReposicaoCriada | null> {
  try {
    return await comRetryDeContencao('a verificação de estoque mínimo', () =>
      // Os 5s padrão do Prisma são curtos demais para este caminho: ele começa
      // por um `SELECT … FOR UPDATE`, que ESPERA quem estiver com a linha de
      // saldo (uma reserva, um recebimento), e a varredura diária ainda paga o
      // custo da primeira conexão com o pooler. Medido no banco compartilhado:
      // a primeira transação da varredura levou 92s e expirou, com a seguinte
      // rodando em milissegundos. A folga não segura trava por mais tempo —
      // só evita desistir de uma espera legítima.
      prisma.$transaction((tx) => executarVerificacao(tx, alvo), { timeout: 30_000, maxWait: 30_000 }),
    );
  } catch (erro) {
    if (colisaoDeReposicaoAutomatica(erro)) return null;
    throw erro;
  }
}

/** Comparação por código de unidade, a mesma de `compararPorPeca`. */
function compararTexto(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Verifica vários pares, um por transação, e NUNCA lança: é o que roda depois
 * de um ato que já comitou (reserva, entrega, recebimento) e na varredura
 * diária, e uma falha aqui não pode desfazer nem interromper nada. Cada falha
 * vira log com peça, depósito e empresa, e a próxima verificação segue.
 *
 * Par repetido é verificado uma vez. A ordem (empresa, depósito, peça) é só
 * para ser estável: os mesmos alvos numeram as solicitações e escrevem o log
 * sempre na mesma sequência.
 */
export async function verificarReposicoesSemFalhar(
  prisma: PrismaClient,
  alvos: AlvoDeReposicao[],
): Promise<{ criadas: number; falhas: number }> {
  const unicos = new Map<string, AlvoDeReposicao>();
  for (const a of alvos) {
    const chave = `${a.companyId}|${a.depositoId}|${a.pecaId}`;
    if (!unicos.has(chave)) unicos.set(chave, { companyId: a.companyId, pecaId: a.pecaId, depositoId: a.depositoId });
  }
  const ordenados = [...unicos.values()].sort(
    (a, b) =>
      compararTexto(a.companyId, b.companyId) ||
      compararTexto(a.depositoId, b.depositoId) ||
      compararTexto(a.pecaId, b.pecaId),
  );

  let criadas = 0;
  let falhas = 0;
  for (const alvo of ordenados) {
    try {
      if (await verificarReposicao(prisma, alvo)) criadas++;
    } catch (erro) {
      falhas++;
      logger.error(
        `Reposição automática não verificada — peça ${alvo.pecaId}, depósito ${alvo.depositoId}, ` +
          `empresa ${alvo.companyId}: ${erro instanceof Error ? erro.message : String(erro)}`,
        erro instanceof Error ? erro.stack : undefined,
      );
    }
  }
  return { criadas, falhas };
}

/**
 * A varredura de todas as empresas com `suprimentos` ligada: cada par (peça
 * ativa com mínimo > 0, depósito ativo) que tem linha de saldo, filtrado pela
 * empresa na peça E no depósito. Uma empresa cuja listagem falha conta uma
 * falha e não impede as outras.
 *
 * Mesma regra de feature do `PainelGuard`: ligada ⇔ existe `company_features`
 * com `enabled` para a chave.
 */
export async function varrerEstoqueMinimo(
  prisma: PrismaClient,
): Promise<{ empresas: number; verificados: number; criadas: number; falhas: number }> {
  const ligadas = await prisma.companyFeature.findMany({
    where: { enabled: true, feature: { key: FEATURE_SUPRIMENTOS } },
    select: { companyId: true },
  });
  const empresas = [...new Set(ligadas.map((l) => l.companyId))].sort(compararTexto);

  const resumo = { empresas: empresas.length, verificados: 0, criadas: 0, falhas: 0 };
  for (const companyId of empresas) {
    let pares: { pecaId: string; depositoId: string }[];
    try {
      pares = await prisma.pecaSaldo.findMany({
        where: {
          peca: { companyId, ativo: true, estoqueMinimo: { gt: 0 } },
          deposito: { companyId, ativo: true },
        },
        select: { pecaId: true, depositoId: true },
      });
    } catch (erro) {
      resumo.falhas++;
      logger.error(
        `Varredura de estoque mínimo não listou a empresa ${companyId}: ` +
          `${erro instanceof Error ? erro.message : String(erro)}`,
        erro instanceof Error ? erro.stack : undefined,
      );
      continue;
    }
    const r = await verificarReposicoesSemFalhar(
      prisma,
      pares.map((p) => ({ companyId, pecaId: p.pecaId, depositoId: p.depositoId })),
    );
    resumo.verificados += pares.length;
    resumo.criadas += r.criadas;
    resumo.falhas += r.falhas;
  }
  return resumo;
}
