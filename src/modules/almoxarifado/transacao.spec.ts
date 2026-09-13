import { Prisma } from '../../prisma/generated/client';
import { alvoDaViolacao, colisaoDeRequisicaoJaAberta, erroDeContencaoTransitoria } from './transacao';

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
  });

  it('meta.code no P2010', () => {
    expect(erroDeContencaoTransitoria(comMeta('P2010', { code: '40P01' }))).toBe(true);
    expect(erroDeContencaoTransitoria(comMeta('P2010', { code: '23505' }))).toBe(false);
  });
});
