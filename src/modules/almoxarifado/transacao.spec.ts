import { Prisma } from '../../prisma/generated/client';
import {
  alvoDaViolacao,
  colisaoDeContagemJaAberta,
  colisaoDeRequisicaoJaAberta,
  compararPorPecaEDeposito,
  erroDeContencaoTransitoria,
} from './transacao';

/**
 * Os erros no formato que o Prisma 7 com `@prisma/adapter-pg` entrega em
 * produção: sem `meta.target` nem `meta.code`, com a causa do driver em
 * `meta.driverAdapterError.cause` (conferido no código instalado do adapter e
 * do client). As specs antigas fabricavam `meta.target`/`meta.code` — o
 * formato do client sem adapter —, e por isso o retry parecia funcionar.
 */
function doAdapter(code: string, cause: Record<string, unknown>): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('erro do adapter', {
    code,
    clientVersion: '7.9.1',
    meta: { modelName: 'RequisicaoMaterial', driverAdapterError: { name: 'DriverAdapterError', cause } },
  });
}
const unique = (fields: string[]) =>
  doAdapter('P2002', { originalCode: '23505', kind: 'UniqueConstraintViolation', constraint: { fields } });
const doPostgres = (code: 'P2010' | 'P2039', sqlstate: string) =>
  doAdapter(code, { originalCode: sqlstate, originalMessage: 'simulado', kind: 'postgres' });

describe('predicados de retry — formato do adapter (produção)', () => {
  it('o alvo da violação são as colunas da causa', () => {
    expect(alvoDaViolacao(unique(['company_id', 'numero']))).toBe('company_id,numero');
  });

  it('P2002 no número é contenção: refaz com o próximo número', () => {
    expect(erroDeContencaoTransitoria(unique(['company_id', 'numero']))).toBe(true);
    expect(colisaoDeRequisicaoJaAberta(unique(['company_id', 'numero']))).toBe(false);
  });

  it('P2002 no índice de requisição aberta por OS é colisão de regra, não contenção', () => {
    const erro = unique(['service_order_id']);
    expect(colisaoDeRequisicaoJaAberta(erro)).toBe(true);
    expect(erroDeContencaoTransitoria(erro)).toBe(false);
  });

  it('P2002 em outro índice não é nenhum dos dois', () => {
    const erro = unique(['requisicao_item_id']);
    expect(colisaoDeRequisicaoJaAberta(erro)).toBe(false);
    expect(erroDeContencaoTransitoria(erro)).toBe(false);
  });

  it('achado I1 do inventário cíclico: P2002 no índice de contagem aberta por depósito é colisão de regra, não contenção', () => {
    const erro = unique(['deposito_id']);
    expect(colisaoDeContagemJaAberta(erro)).toBe(true);
    expect(colisaoDeRequisicaoJaAberta(erro)).toBe(false);
    expect(erroDeContencaoTransitoria(erro)).toBe(false);
  });

  it.each([
    ['deadlock numa trava (raw)', 'P2010', '40P01'],
    ['serialização numa trava (raw)', 'P2010', '40001'],
    ['deadlock numa operação de modelo', 'P2039', '40P01'],
  ] as const)('%s é contenção', (_nome, code, sqlstate) => {
    expect(erroDeContencaoTransitoria(doPostgres(code, sqlstate))).toBe(true);
  });

  it('serialização numa operação de modelo chega como P2034 e é contenção', () => {
    expect(erroDeContencaoTransitoria(doAdapter('P2034', { originalCode: '40001', kind: 'TransactionWriteConflict' }))).toBe(true);
  });

  it.each([
    ['unique numa raw query', 'P2010', '23505'],
    ['CHECK numa operação de modelo', 'P2039', '23514'],
  ] as const)('%s não é contenção', (_nome, code, sqlstate) => {
    expect(erroDeContencaoTransitoria(doPostgres(code, sqlstate))).toBe(false);
  });

  it('causa sem restrição: alvo vazio, nem colisão nem contenção', () => {
    const erro = doAdapter('P2002', { originalCode: '23505', kind: 'UniqueConstraintViolation' });
    expect(alvoDaViolacao(erro)).toBe('');
    expect(colisaoDeRequisicaoJaAberta(erro)).toBe(false);
    expect(erroDeContencaoTransitoria(erro)).toBe(false);
  });
});

describe('predicados de retry — formato sem adapter continua aceito', () => {
  const comMeta = (code: string, meta: Record<string, unknown>) =>
    new Prisma.PrismaClientKnownRequestError('erro', { code, clientVersion: '7.9.1', meta });

  it('meta.target em campos do schema ou nome do índice', () => {
    expect(erroDeContencaoTransitoria(comMeta('P2002', { target: ['companyId', 'numero'] }))).toBe(true);
    expect(colisaoDeRequisicaoJaAberta(comMeta('P2002', { target: 'requisicoes_material_uma_aberta_por_os' }))).toBe(true);
    expect(colisaoDeContagemJaAberta(comMeta('P2002', { target: 'inventarios_uma_aberta_por_deposito' }))).toBe(true);
    expect(colisaoDeContagemJaAberta(comMeta('P2002', { target: ['depositoId'] }))).toBe(true);
  });

  it('meta.code no P2010', () => {
    expect(erroDeContencaoTransitoria(comMeta('P2010', { code: '40P01' }))).toBe(true);
    expect(erroDeContencaoTransitoria(comMeta('P2010', { code: '23505' }))).toBe(false);
  });
});

describe('compararPorPecaEDeposito', () => {
  const linha = (pecaId: string, depositoId: string) => ({ pecaId, depositoId });

  it('ordena por peça primeiro — é o que compõe com o resto do módulo', () => {
    // Todo outro ato trava por `pecaId`. Se este ordenasse por depósito
    // primeiro, uma transferência e um recebimento poderiam pegar as mesmas
    // duas linhas em ordens opostas.
    expect(compararPorPecaEDeposito(linha('p-1', 'dep-9'), linha('p-2', 'dep-1'))).toBeLessThan(0);
  });

  it('mesma peça em depósitos diferentes desempata pelo depósito', () => {
    // É o caso que `compararPorPeca` devolve 0 — e 0 deixa a ordem ao acaso,
    // que é deadlock com a transferência simétrica.
    expect(compararPorPecaEDeposito(linha('p-1', 'dep-a'), linha('p-1', 'dep-b'))).toBeLessThan(0);
    expect(compararPorPecaEDeposito(linha('p-1', 'dep-b'), linha('p-1', 'dep-a'))).toBeGreaterThan(0);
  });

  it('a mesma linha compara igual', () => {
    expect(compararPorPecaEDeposito(linha('p-1', 'dep-a'), linha('p-1', 'dep-a'))).toBe(0);
  });

  it('duas transferências em sentidos opostos produzem a MESMA ordem de trava', () => {
    // O teste que justifica a função existir. A→B e B→A têm de travar a mesma
    // linha primeiro, senão uma espera a outra em círculo.
    const aParaB = [linha('p-1', 'dep-b'), linha('p-1', 'dep-a')].sort(compararPorPecaEDeposito);
    const bParaA = [linha('p-1', 'dep-a'), linha('p-1', 'dep-b')].sort(compararPorPecaEDeposito);
    expect(aParaB).toEqual(bParaA);
  });
});
