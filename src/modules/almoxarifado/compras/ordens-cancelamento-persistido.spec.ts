import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  ANO,
  COMPRADOR,
  DEPOSITO,
  EMPRESA,
  PECA_A,
  montarBancoFalso,
  sqlsDeSaldo,
} from './banco-falso.fake-spec';

const ato = (motivo: string, autorCompanyUserId: string = COMPRADOR) => ({
  companyId: EMPRESA, ordemCompraId: 'oc-1', autorCompanyUserId, motivo,
});

/**
 * Falta de 2 (pediu 5, reservou 3) coberta por uma OC de 2. O
 * `saldo_em_compra` da peça no depósito é 5: 2 desta OC e 3 de outras compras.
 */
function compraCobrindoFalta(status: string, statusMateriais: string, statusSolicitacao: string) {
  const b = montarBancoFalso();
  b.plantarFaltaDeOs({
    serviceOrderId: 'os-1', protocolo: 'OS-2026-047', statusMateriais,
    requisicaoId: 'req-1', requisicaoItemId: 'ri-1', pecaId: PECA_A, solicitada: 5, reservada: 3,
    solicitacaoId: 'sc-falta', solicitacaoNumero: `SC-${ANO}-001`, solicitacaoItemId: 'sci-falta',
    quantidadeSolicitacao: 2, statusSolicitacao,
  });
  b.plantarOrdem({
    id: 'oc-1', numero: `OC-${ANO}-001`, status,
    itens: [{ id: 'oci-1', pecaId: PECA_A, quantidade: 2, valorUnit: 250, origens: [{ id: 'ori-1', solicitacaoCompraItemId: 'sci-falta', quantidade: 2 }] }],
  });
  b.plantarSaldo(PECA_A, DEPOSITO, 5);
  return b;
}

describe('cancelarOrdem', () => {
  it.each(['emitida', 'enviada'])(
    'OC %s: subtrai o pendente do saldo_em_compra (SQL relativo), devolve a OS a aguardando_compra e a SC a pendente — gravado',
    async (status) => {
      const b = compraCobrindoFalta(status, 'compra_em_andamento', 'aprovada');

      const r = await b.servico.cancelarOrdem(ato('  Fornecedor sem estoque  '));

      expect(b.banco.ordem('oc-1')).toMatchObject({
        status: 'cancelada', canceladaPorCompanyUserId: COMPRADOR, motivoCancelamento: 'Fornecedor sem estoque',
      });
      expect(b.banco.ordem('oc-1')?.canceladaEm).toBeInstanceOf(Date);
      const sqls = sqlsDeSaldo(b.tx);
      expect(sqls).toHaveLength(1);
      expect(sqls[0].texto).toMatch(/saldo_em_compra\s*=\s*saldo_em_compra\s*-\s*\$1/);
      expect(sqls[0].valores).toEqual([2, PECA_A, DEPOSITO]);
      expect(b.banco.saldo(PECA_A, DEPOSITO)?.saldoEmCompra).toBe(3);
      expect(b.banco.os('os-1')?.statusMateriais).toBe('aguardando_compra');
      expect(b.banco.solicitacao('sc-falta')?.status).toBe('pendente');
      // A necessidade continua viva e cotável de novo.
      expect(b.banco.itemDeSolicitacao('sci-falta')?.status).toBe('aberta');
      expect(b.travas).toEqual([
        'ordens_compra:oc-1',
        'requisicoes_material:req-1',
        'solicitacao_compra_itens:sci-falta',
        'peca_saldos:peca-a',
        'solicitacoes_compra:sc-falta',
      ]);
      expect(b.banco.auditoria()).toEqual([
        expect.objectContaining({ acao: 'ordem_compra.cancelar', alvoId: 'oc-1', motivo: 'Fornecedor sem estoque' }),
      ]);
      expect(r).toMatchObject({ id: 'oc-1', status: 'cancelada' });
    },
  );

  it.each(['rascunho', 'aguardando_aprovacao'])(
    'OC %s: só o estado da OC e o da SC mudam — nada de saldo, requisição ou OS',
    async (status) => {
      const b = compraCobrindoFalta(status, 'aguardando_compra', 'em_cotacao');

      await b.servico.cancelarOrdem(ato('Cotação refeita com outro fornecedor'));

      expect(b.banco.ordem('oc-1')?.status).toBe('cancelada');
      expect(b.banco.solicitacao('sc-falta')?.status).toBe('pendente');
      expect(b.tx.$executeRaw).not.toHaveBeenCalled();
      expect(b.tx.pecaSaldo.upsert).not.toHaveBeenCalled();
      expect(b.banco.saldo(PECA_A, DEPOSITO)?.saldoEmCompra).toBe(5);
      expect(b.travas).toEqual(['ordens_compra:oc-1', 'solicitacao_compra_itens:sci-falta', 'solicitacoes_compra:sc-falta']);
      expect(b.banco.os('os-1')?.statusMateriais).toBe('aguardando_compra');
    },
  );

  it('OC com recebimento parcial não é cancelada: 409 mandando encerrar, e nada muda', async () => {
    const b = compraCobrindoFalta('recebida_parcial', 'recebimento_parcial', 'aprovada');

    const erro = await b.servico.cancelarOrdem(ato('Não vem mais')).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ConflictException);
    expect((erro as Error).message).toContain('encerre');
    expect(b.banco.ordem('oc-1')?.status).toBe('recebida_parcial');
    expect(b.banco.saldo(PECA_A, DEPOSITO)?.saldoEmCompra).toBe(5);
  });

  it('transição concorrente (count 0): 409 e o saldo não desce, a OS não volta', async () => {
    const b = compraCobrindoFalta('emitida', 'compra_em_andamento', 'aprovada');
    b.ganchos.contagemDaProximaTransicaoDaOrdem = 0;

    await expect(b.servico.cancelarOrdem(ato('Fornecedor sem estoque'))).rejects.toBeInstanceOf(ConflictException);

    expect(b.banco.ordem('oc-1')?.status).toBe('emitida');
    expect(b.banco.saldo(PECA_A, DEPOSITO)?.saldoEmCompra).toBe(5);
    expect(b.banco.os('os-1')?.statusMateriais).toBe('compra_em_andamento');
    expect(b.banco.auditoria()).toEqual([]);
  });

  it('motivo vazio: 400 antes de abrir transação', async () => {
    const b = compraCobrindoFalta('emitida', 'compra_em_andamento', 'aprovada');
    await expect(b.servico.cancelarOrdem(ato('  '))).rejects.toBeInstanceOf(BadRequestException);
    expect(b.prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('encerrarOrdem', () => {
  /**
   * Pediu 10 e reservou 4 (os 4 que já chegaram): falta 6. A OC de 10 recebeu
   * 4 — o recebimento já tirou esses 4 do `saldo_em_compra`, que está em 6.
   */
  function recebidaEmParte() {
    const b = montarBancoFalso();
    b.plantarFaltaDeOs({
      serviceOrderId: 'os-1', protocolo: 'OS-2026-047', statusMateriais: 'recebimento_parcial',
      requisicaoId: 'req-1', requisicaoItemId: 'ri-1', pecaId: PECA_A, solicitada: 10, reservada: 4,
      solicitacaoId: 'sc-falta', solicitacaoNumero: `SC-${ANO}-001`, solicitacaoItemId: 'sci-falta',
      quantidadeSolicitacao: 10, statusSolicitacao: 'aprovada',
    });
    b.plantarOrdem({
      id: 'oc-1', numero: `OC-${ANO}-001`, status: 'recebida_parcial',
      itens: [{
        id: 'oci-1', pecaId: PECA_A, quantidade: 10, quantidadeRecebida: 4, valorUnit: 30,
        origens: [{ id: 'ori-1', solicitacaoCompraItemId: 'sci-falta', quantidade: 10, quantidadeRecebida: 4 }],
      }],
    });
    b.plantarSaldo(PECA_A, DEPOSITO, 6);
    return b;
  }

  it('subtrai SÓ o pendente (10 − 4 = 6), a falta volta a ficar sem cobertura e a SC volta a ter o que cotar', async () => {
    const b = recebidaEmParte();

    await b.servico.encerrarOrdem(ato('Fornecedor descontinuou a peça'));

    expect(b.banco.ordem('oc-1')).toMatchObject({
      status: 'encerrada', encerradaPorCompanyUserId: COMPRADOR, motivoEncerramento: 'Fornecedor descontinuou a peça',
    });
    expect(b.banco.ordem('oc-1')?.encerradaEm).toBeInstanceOf(Date);
    const sqls = sqlsDeSaldo(b.tx);
    expect(sqls.map((s) => s.valores)).toEqual([[6, PECA_A, DEPOSITO]]);
    expect(sqls[0].texto).toMatch(/saldo_em_compra\s*=\s*saldo_em_compra\s*-\s*\$1/);
    expect(b.banco.saldo(PECA_A, DEPOSITO)?.saldoEmCompra).toBe(0);
    expect(b.banco.os('os-1')?.statusMateriais).toBe('aguardando_compra');
    expect(b.banco.solicitacao('sc-falta')?.status).toBe('em_cotacao');
    const sc = await b.servico.detalharSolicitacao(EMPRESA, 'sc-falta');
    expect(sc.itens[0]).toMatchObject({ comprado: 4, recebido: 4, emCotacao: 0, disponivelParaCotar: 6 });
    expect(b.banco.auditoria()).toEqual([expect.objectContaining({ acao: 'ordem_compra.encerrar', motivo: 'Fornecedor descontinuou a peça' })]);
  });

  it.each(['emitida', 'rascunho'])('OC %s não é encerrada: 409 e o saldo não desce', async (status) => {
    const b = recebidaEmParte();
    b.banco.ordem('oc-1')!.status = status;
    await expect(b.servico.encerrarOrdem(ato('Não vem mais'))).rejects.toBeInstanceOf(ConflictException);
    expect(b.banco.saldo(PECA_A, DEPOSITO)?.saldoEmCompra).toBe(6);
  });
});
