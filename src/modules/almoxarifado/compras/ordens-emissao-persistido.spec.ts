import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  ADMIN,
  ANO,
  COMPRADOR,
  DEPOSITO,
  DEPOSITO_DE_FORA,
  DONO,
  DONO_DE_FORA,
  EMPRESA,
  FORNECEDOR,
  FORNECEDOR_DE_FORA,
  GESTOR,
  OUTRA_EMPRESA,
  PECA_A,
  PECA_B,
  PECA_C,
  montarBancoFalso,
  sqlsDeSaldo,
} from './banco-falso.fake-spec';

type Banco = ReturnType<typeof montarBancoFalso>;

/**
 * A OS-2026-047 parada por falta: pediu 5, reservou 3, faltam 2. A SC
 * `falta_os` dessa falta já está numa OC em rascunho de 2 × R$ 250 = R$ 500.
 */
function cenarioDeFalta(preparar: (b: Banco) => void = () => undefined): Banco {
  const b = montarBancoFalso();
  preparar(b);
  b.plantarFaltaDeOs({
    serviceOrderId: 'os-1', protocolo: 'OS-2026-047', statusMateriais: 'aguardando_compra',
    requisicaoId: 'req-1', requisicaoItemId: 'ri-1', pecaId: PECA_A, solicitada: 5, reservada: 3,
    solicitacaoId: 'sc-falta', solicitacaoNumero: `SC-${ANO}-001`, solicitacaoItemId: 'sci-falta',
    quantidadeSolicitacao: 2, statusSolicitacao: 'em_cotacao',
  });
  b.plantarOrdem({
    id: 'oc-1', numero: `OC-${ANO}-001`, status: 'rascunho',
    itens: [{ id: 'oci-1', pecaId: PECA_A, quantidade: 2, valorUnit: 250, origens: [{ id: 'ori-1', solicitacaoCompraItemId: 'sci-falta', quantidade: 2 }] }],
  });
  return b;
}

const ato = (autorCompanyUserId: string = COMPRADOR, ordemCompraId = 'oc-1') => ({
  companyId: EMPRESA, ordemCompraId, autorCompanyUserId,
});

describe('confirmarOrdem — a aprovação por valor mora na OC', () => {
  it('limite NULO (sem linha em company_settings): pede aprovação, e nada de saldo, requisição, SC ou OS muda', async () => {
    const b = cenarioDeFalta();

    const r = await b.servico.confirmarOrdem(ato());

    expect(b.banco.ordem('oc-1')).toMatchObject({
      status: 'aguardando_aprovacao', valorTotal: 500, emitidaEm: null, emitidaPorCompanyUserId: null,
    });
    expect(b.tx.$executeRaw).not.toHaveBeenCalled();
    expect(b.banco.saldo(PECA_A, DEPOSITO)).toBeNull();
    expect(b.banco.os('os-1')?.statusMateriais).toBe('aguardando_compra');
    expect(b.banco.solicitacao('sc-falta')?.status).toBe('em_cotacao');
    expect(b.travas.filter((t) => t.startsWith('requisicoes_material') || t.startsWith('peca_saldos'))).toEqual([]);
    expect(b.banco.auditoria()).toEqual([
      expect.objectContaining({ acao: 'ordem_compra.confirmar', alvoTipo: 'suprimentos.ordem_compra', alvoId: 'oc-1', atorId: COMPRADOR }),
    ]);
    expect(r).toMatchObject({ status: 'aguardando_aprovacao', exigeAprovacao: true, podeAprovar: false });
  });

  it('limite nulo COM a linha configurada também pede aprovação, e avisa OWNER/ADMIN ativos e o gestor master — gravado com this.prisma, nunca com tx', async () => {
    const b = cenarioDeFalta((x) => x.configurar({ limite: null, gestorMaster: GESTOR }));

    await b.servico.confirmarOrdem(ato());

    expect(b.banco.ordem('oc-1')?.status).toBe('aguardando_aprovacao');
    expect(b.tx.notificacao.createMany).not.toHaveBeenCalled();
    expect(b.prisma.notificacao.createMany).toHaveBeenCalledTimes(1);
    // Nem o admin inativo, nem o MEMBER comum, nem o dono de outra empresa.
    expect(b.notificacoesGravadas.map((n) => n.destinatarioId).sort()).toEqual([ADMIN, DONO, GESTOR].sort());
    for (const n of b.notificacoesGravadas) {
      expect(n).toMatchObject({
        companyId: EMPRESA, destinatarioTipo: 'company_user', prefeituraLegacyId: 'leg-empresa-1',
        referenciaTipo: 'ordem_compra', referenciaId: 'oc-1',
      });
      expect(n.titulo).toContain(`OC-${ANO}-001`);
      expect(n.mensagem).toContain('Peças RC');
    }
  });

  it('total IGUAL ao limite: emitida na hora, com quem confirmou como emissor e sem aprovação', async () => {
    const b = cenarioDeFalta((x) => x.configurar({ limite: 500 }));

    const r = await b.servico.confirmarOrdem(ato());

    expect(b.banco.ordem('oc-1')).toMatchObject({
      status: 'emitida', valorTotal: 500, emitidaPorCompanyUserId: COMPRADOR, aprovadaEm: null, aprovadaPorCompanyUserId: null,
    });
    expect(b.banco.ordem('oc-1')?.emitidaEm).toBeInstanceOf(Date);
    expect(b.banco.auditoria()).toEqual([expect.objectContaining({ acao: 'ordem_compra.emitir', alvoId: 'oc-1' })]);
    expect(b.prisma.notificacao.createMany).not.toHaveBeenCalled();
    expect(r).toMatchObject({ status: 'emitida', exigeAprovacao: false });
  });

  it('um centavo acima do limite: aguardando aprovação', async () => {
    const b = cenarioDeFalta((x) => x.configurar({ limite: 499.99 }));
    await b.servico.confirmarOrdem(ato());
    expect(b.banco.ordem('oc-1')?.status).toBe('aguardando_aprovacao');
  });

  it('fracionamento: três SC de R$ 400 numa OC com limite de R$ 1.000 — o TOTAL (R$ 1.200) pede aprovação', async () => {
    const b = montarBancoFalso();
    b.configurar({ limite: 1000 });
    const partes = [['sc-a', PECA_A, 'sci-a'], ['sc-b', PECA_B, 'sci-b'], ['sc-c', PECA_C, 'sci-c']] as const;
    for (const [id, pecaId, itemId] of partes) {
      b.plantarSolicitacao({ id, numero: `SC-${id}`, status: 'em_cotacao', itens: [{ id: itemId, pecaId, quantidade: 1 }] });
    }
    b.plantarOrdem({
      id: 'oc-f', numero: `OC-${ANO}-009`,
      itens: partes.map(([, pecaId, itemId], n) => ({
        id: `oci-${n}`, pecaId, quantidade: 1, valorUnit: 400,
        origens: [{ id: `o-${n}`, solicitacaoCompraItemId: itemId, quantidade: 1 }],
      })),
    });

    await b.servico.confirmarOrdem(ato(COMPRADOR, 'oc-f'));

    expect(b.banco.ordem('oc-f')).toMatchObject({ status: 'aguardando_aprovacao', valorTotal: 1200 });
    expect(b.tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('item de SC cancelado depois da cotação (a requisição foi cancelada): 409 citando a SC, e nada muda', async () => {
    const b = cenarioDeFalta((x) => x.configurar({ limite: 1000 }));
    b.banco.itemDeSolicitacao('sci-falta')!.status = 'cancelada';
    b.banco.solicitacao('sc-falta')!.status = 'cancelada';

    const erro = await b.servico.confirmarOrdem(ato()).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ConflictException);
    expect((erro as Error).message).toContain(`SC-${ANO}-001`);
    expect(b.banco.ordem('oc-1')?.status).toBe('rascunho');
    expect(b.banco.saldo(PECA_A, DEPOSITO)).toBeNull();
  });

  it('fornecedor desativado depois da cotação: 409', async () => {
    const b = cenarioDeFalta((x) => x.configurar({ limite: 1000 }));
    b.banco.tabelas().partners.find((p) => p.id === FORNECEDOR)!.ativo = false;
    await expect(b.servico.confirmarOrdem(ato())).rejects.toBeInstanceOf(ConflictException);
    expect(b.banco.ordem('oc-1')?.status).toBe('rascunho');
  });

  it('rascunho sem itens: 409', async () => {
    const b = montarBancoFalso();
    b.plantarOrdem({ id: 'oc-vazia', numero: 'OC-V' });
    await expect(b.servico.confirmarOrdem(ato(COMPRADOR, 'oc-vazia'))).rejects.toBeInstanceOf(ConflictException);
  });

  it('só de rascunho: ordem já emitida devolve 409 e o saldo não sobe de novo', async () => {
    const b = cenarioDeFalta((x) => x.configurar({ limite: 1000 }));
    b.banco.ordem('oc-1')!.status = 'emitida';
    await expect(b.servico.confirmarOrdem(ato())).rejects.toBeInstanceOf(ConflictException);
    expect(b.tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('ordem de outra empresa: 404', async () => {
    const b = montarBancoFalso();
    b.plantarOrdem({ id: 'oc-fora', numero: 'OC-F', companyId: OUTRA_EMPRESA, partnerId: FORNECEDOR_DE_FORA, depositoId: DEPOSITO_DE_FORA });
    await expect(b.servico.confirmarOrdem(ato(COMPRADOR, 'oc-fora'))).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('emissão — saldo em compra e a OS, pelo que fica gravado', () => {
  it('SOMA saldo_em_compra com aritmética relativa e leva a OS de aguardando_compra a compra_em_andamento', async () => {
    const b = cenarioDeFalta((x) => x.configurar({ limite: 1000 }));
    b.plantarSaldo(PECA_A, DEPOSITO, 5);

    await b.servico.confirmarOrdem(ato());

    const sqls = sqlsDeSaldo(b.tx);
    expect(sqls).toHaveLength(1);
    expect(sqls[0].texto).toMatch(/saldo_em_compra\s*=\s*saldo_em_compra\s*\+\s*\$1/);
    expect(sqls[0].valores).toEqual([2, PECA_A, DEPOSITO]);
    expect(b.banco.saldo(PECA_A, DEPOSITO)?.saldoEmCompra).toBe(7);
    expect(b.banco.os('os-1')?.statusMateriais).toBe('compra_em_andamento');
    expect(b.banco.solicitacao('sc-falta')?.status).toBe('aprovada');
  });

  it('peça que nunca teve saldo no depósito: a linha nasce (upsert sem update) antes da trava e recebe a soma', async () => {
    const b = cenarioDeFalta((x) => x.configurar({ limite: 1000 }));

    await b.servico.confirmarOrdem(ato());

    expect(b.tx.pecaSaldo.upsert).toHaveBeenCalledWith({
      where: { pecaId_depositoId: { pecaId: PECA_A, depositoId: DEPOSITO } },
      create: { pecaId: PECA_A, depositoId: DEPOSITO },
      update: {},
    });
    expect(b.banco.saldo(PECA_A, DEPOSITO)?.saldoEmCompra).toBe(2);
  });

  it('ordem única de trava: OC → requisições por id → linhas de SC → peca_saldos por peça → cabeçalhos de SC (a ordem do recebimento)', async () => {
    const b = montarBancoFalso();
    b.configurar({ limite: 10000 });
    // Plantadas fora de ordem, e a OC lista a peça B antes da A.
    for (const s of ['b', 'a']) {
      b.plantarFaltaDeOs({
        serviceOrderId: `os-${s}`, protocolo: `OS-${s}`, statusMateriais: 'aguardando_compra',
        requisicaoId: `req-${s}`, requisicaoItemId: `ri-${s}`, pecaId: `peca-${s}`, solicitada: 1, reservada: 0,
        solicitacaoId: `sc-${s}`, solicitacaoNumero: `SC-${s}`, solicitacaoItemId: `sci-${s}`, quantidadeSolicitacao: 1,
      });
    }
    b.plantarOrdem({
      id: 'oc-t', numero: 'OC-T',
      itens: [
        { id: 'oci-b', pecaId: PECA_B, quantidade: 1, valorUnit: 10, origens: [{ id: 'o-b', solicitacaoCompraItemId: 'sci-b', quantidade: 1 }] },
        { id: 'oci-a', pecaId: PECA_A, quantidade: 1, valorUnit: 10, origens: [{ id: 'o-a', solicitacaoCompraItemId: 'sci-a', quantidade: 1 }] },
      ],
    });

    await b.servico.confirmarOrdem(ato(COMPRADOR, 'oc-t'));

    expect(b.travas).toEqual([
      'ordens_compra:oc-t',
      'requisicoes_material:req-a',
      'requisicoes_material:req-b',
      'solicitacao_compra_itens:sci-a',
      'solicitacao_compra_itens:sci-b',
      'peca_saldos:peca-a',
      'peca_saldos:peca-b',
      'solicitacoes_compra:sc-a',
      'solicitacoes_compra:sc-b',
    ]);
    expect(b.banco.os('os-a')?.statusMateriais).toBe('compra_em_andamento');
    expect(b.banco.os('os-b')?.statusMateriais).toBe('compra_em_andamento');
  });

  it('transição concorrente (count 0 no updateMany guardado): 409 e nenhuma escrita fica — nem saldo, OS, SC, rastro ou aviso', async () => {
    const b = cenarioDeFalta((x) => x.configurar({ limite: 1000 }));
    b.plantarSaldo(PECA_A, DEPOSITO, 5);
    b.ganchos.contagemDaProximaTransicaoDaOrdem = 0;

    await expect(b.servico.confirmarOrdem(ato())).rejects.toBeInstanceOf(ConflictException);

    expect(b.banco.ordem('oc-1')?.status).toBe('rascunho');
    expect(b.banco.saldo(PECA_A, DEPOSITO)?.saldoEmCompra).toBe(5);
    expect(b.banco.os('os-1')?.statusMateriais).toBe('aguardando_compra');
    expect(b.banco.solicitacao('sc-falta')?.status).toBe('em_cotacao');
    expect(b.banco.auditoria()).toEqual([]);
    expect(b.prisma.notificacao.createMany).not.toHaveBeenCalled();
  });
});

describe('aprovar e devolver', () => {
  /** A mesma OC, já confirmada acima de um limite de R$ 100. */
  function aguardando(gestorMaster: string | null = GESTOR): Banco {
    const b = cenarioDeFalta((x) => x.configurar({ limite: 100, gestorMaster }));
    Object.assign(b.banco.ordem('oc-1')!, { status: 'aguardando_aprovacao', valorTotal: 500 });
    return b;
  }

  it.each([
    ['MEMBER que não é o gestor master', COMPRADOR],
    ['OWNER de OUTRA empresa', DONO_DE_FORA],
  ])('%s: 403 com a mensagem do contrato; a ordem continua aguardando e o saldo não sobe', async (_rotulo, autor) => {
    const b = aguardando();

    const erro = await b.servico.aprovarOrdem(ato(autor)).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ForbiddenException);
    expect((erro as Error).message).toBe('Só OWNER/ADMIN ou o gestor master aprovam ordem de compra acima do limite.');
    expect(b.banco.ordem('oc-1')?.status).toBe('aguardando_aprovacao');
    expect(b.tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('gestor master MEMBER aprova: emitida com aprovação e emissão dele, saldo somado e OS em compra_em_andamento', async () => {
    const b = aguardando(GESTOR);

    const r = await b.servico.aprovarOrdem(ato(GESTOR));

    expect(b.banco.ordem('oc-1')).toMatchObject({
      status: 'emitida', aprovadaPorCompanyUserId: GESTOR, emitidaPorCompanyUserId: GESTOR,
    });
    expect(b.banco.ordem('oc-1')?.aprovadaEm).toBeInstanceOf(Date);
    expect(b.banco.ordem('oc-1')?.emitidaEm).toBeInstanceOf(Date);
    expect(b.banco.saldo(PECA_A, DEPOSITO)?.saldoEmCompra).toBe(2);
    expect(b.banco.os('os-1')?.statusMateriais).toBe('compra_em_andamento');
    expect(b.banco.auditoria()).toEqual([expect.objectContaining({ acao: 'ordem_compra.aprovar', atorId: GESTOR })]);
    expect(r).toMatchObject({ status: 'emitida', podeAprovar: false });
  });

  it('o mesmo MEMBER, quando a empresa não o configurou como gestor master, não aprova', async () => {
    const b = aguardando(null);
    await expect(b.servico.aprovarOrdem(ato(GESTOR))).rejects.toBeInstanceOf(ForbiddenException);
    expect(b.banco.ordem('oc-1')?.status).toBe('aguardando_aprovacao');
  });

  it('SC da origem cancelada enquanto a ordem esperava: aprovar recusa com 409 citando a SC, sem saldo', async () => {
    const b = aguardando();
    b.banco.itemDeSolicitacao('sci-falta')!.status = 'cancelada';
    b.banco.solicitacao('sc-falta')!.status = 'cancelada';

    const erro = await b.servico.aprovarOrdem(ato(ADMIN)).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ConflictException);
    expect((erro as Error).message).toContain(`SC-${ANO}-001`);
    expect(b.banco.ordem('oc-1')?.status).toBe('aguardando_aprovacao');
    expect(b.banco.saldo(PECA_A, DEPOSITO)).toBeNull();
  });

  it('aprovar ordem que não está aguardando aprovação: 409', async () => {
    const b = cenarioDeFalta((x) => x.configurar({ limite: 100 }));
    await expect(b.servico.aprovarOrdem(ato(ADMIN))).rejects.toBeInstanceOf(ConflictException);
    expect(b.banco.ordem('oc-1')?.status).toBe('rascunho');
  });

  it('devolver: MEMBER leva 403; ADMIN devolve a rascunho com motivo e avisa quem criou — gravado com this.prisma', async () => {
    const b = aguardando();

    await expect(b.servico.devolverOrdem({ ...ato(COMPRADOR), motivo: 'Preço alto demais' })).rejects.toBeInstanceOf(ForbiddenException);
    const r = await b.servico.devolverOrdem({ ...ato(ADMIN), motivo: '  Preço acima da tabela  ' });

    expect(b.banco.ordem('oc-1')).toMatchObject({
      status: 'rascunho', devolvidaPorCompanyUserId: ADMIN, motivoDevolucao: 'Preço acima da tabela',
    });
    expect(b.banco.ordem('oc-1')?.devolvidaEm).toBeInstanceOf(Date);
    expect(b.tx.notificacao.createMany).not.toHaveBeenCalled();
    expect(b.notificacoesGravadas).toEqual([
      expect.objectContaining({ destinatarioId: COMPRADOR, referenciaTipo: 'ordem_compra', referenciaId: 'oc-1' }),
    ]);
    expect(b.notificacoesGravadas[0].mensagem).toContain('Preço acima da tabela');
    expect(b.banco.auditoria()).toEqual([
      expect.objectContaining({ acao: 'ordem_compra.devolver', motivo: 'Preço acima da tabela', atorId: ADMIN }),
    ]);
    expect(r).toMatchObject({ status: 'rascunho', motivoDevolucao: 'Preço acima da tabela', podeAprovar: false });
  });
});

describe('enviarOrdem', () => {
  it('emitida → enviada com quem enviou; saldo e OS não mudam', async () => {
    const b = cenarioDeFalta();
    b.banco.ordem('oc-1')!.status = 'emitida';
    b.banco.os('os-1')!.statusMateriais = 'compra_em_andamento';
    b.plantarSaldo(PECA_A, DEPOSITO, 2);

    await b.servico.enviarOrdem(ato());

    expect(b.banco.ordem('oc-1')).toMatchObject({ status: 'enviada', enviadaPorCompanyUserId: COMPRADOR });
    expect(b.banco.ordem('oc-1')?.enviadaEm).toBeInstanceOf(Date);
    expect(b.tx.$executeRaw).not.toHaveBeenCalled();
    expect(b.banco.saldo(PECA_A, DEPOSITO)?.saldoEmCompra).toBe(2);
    expect(b.banco.os('os-1')?.statusMateriais).toBe('compra_em_andamento');
    expect(b.banco.auditoria()).toEqual([expect.objectContaining({ acao: 'ordem_compra.enviar' })]);
  });

  it('rascunho não é enviado: 409', async () => {
    const b = cenarioDeFalta();
    await expect(b.servico.enviarOrdem(ato())).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('listarOrdens e detalharOrdem — a forma que o painel lê', () => {
  it('sem status: as cinco em andamento desta empresa; exigeAprovacao pelo limite atual; podeAprovar só para quem aprova, na que espera', async () => {
    const b = cenarioDeFalta((x) => x.configurar({ limite: 1000 }));
    const estados = ['aguardando_aprovacao', 'emitida', 'enviada', 'recebida_parcial', 'recebida', 'encerrada', 'cancelada'];
    estados.forEach((status, n) =>
      b.plantarOrdem({ id: `oc-${status}`, numero: `OC-${ANO}-1${n}`, status, valorTotal: 1200 }),
    );
    b.plantarOrdem({ id: 'oc-fora', numero: 'OC-FORA', companyId: OUTRA_EMPRESA, partnerId: FORNECEDOR_DE_FORA, depositoId: DEPOSITO_DE_FORA });

    const doAdmin = await b.servico.listarOrdens(EMPRESA, ADMIN);

    expect(doAdmin.map((o) => o.status).sort()).toEqual(
      ['aguardando_aprovacao', 'emitida', 'enviada', 'rascunho', 'recebida_parcial'].sort(),
    );
    expect(doAdmin.find((o) => o.id === 'oc-aguardando_aprovacao')).toMatchObject({ valorTotal: 1200, exigeAprovacao: true, podeAprovar: true });
    expect(doAdmin.find((o) => o.id === 'oc-emitida')).toMatchObject({ exigeAprovacao: true, podeAprovar: false });
    expect(doAdmin.find((o) => o.id === 'oc-1')).toMatchObject({ valorTotal: 0, exigeAprovacao: false, podeAprovar: false });
    const doComprador = await b.servico.listarOrdens(EMPRESA, COMPRADOR);
    expect(doComprador.find((o) => o.id === 'oc-aguardando_aprovacao')?.podeAprovar).toBe(false);
    expect((await b.servico.listarOrdens(EMPRESA, ADMIN, 'cancelada')).map((o) => o.id)).toEqual(['oc-cancelada']);
  });

  it('detalhar: números como number, fornecedor, depósito e as origens com a SC e a OS', async () => {
    const b = cenarioDeFalta();

    const oc = await b.servico.detalharOrdem(EMPRESA, COMPRADOR, 'oc-1');

    expect(oc).toEqual({
      id: 'oc-1',
      numero: `OC-${ANO}-001`,
      status: 'rascunho',
      fornecedor: { id: FORNECEDOR, razaoSocial: 'Peças Rio Claro Ltda', nomeFantasia: 'Peças RC', cnpj: '11.111.111/0001-11' },
      deposito: { id: DEPOSITO, nome: 'Almoxarifado Central' },
      condicaoPagamento: null,
      previsaoEntrega: null,
      observacao: null,
      valorTotal: 0,
      motivoDevolucao: null,
      createdAt: expect.any(Date),
      emitidaEm: null,
      aprovadaEm: null,
      enviadaEm: null,
      // Sem linha em company_settings: sem limite, toda OC pede aprovação.
      exigeAprovacao: true,
      podeAprovar: false,
      itens: [
        {
          id: 'oci-1',
          peca: { id: PECA_A, codigoInterno: 'ALM-000001', descricao: 'Filtro de óleo', unidade: 'un' },
          quantidade: 2,
          quantidadeRecebida: 0,
          valorUnit: 250,
          origens: [
            {
              id: 'ori-1', quantidade: 2, quantidadeRecebida: 0, solicitacaoCompraItemId: 'sci-falta',
              solicitacao: { id: 'sc-falta', numero: `SC-${ANO}-001`, prioridade: 'critica' },
              serviceOrder: { id: 'os-1', protocolo: 'OS-2026-047' },
            },
          ],
        },
      ],
    });
  });

  it('detalhar ordem de outra empresa: 404', async () => {
    const b = montarBancoFalso();
    b.plantarOrdem({ id: 'oc-fora', numero: 'OC-F', companyId: OUTRA_EMPRESA, partnerId: FORNECEDOR_DE_FORA, depositoId: DEPOSITO_DE_FORA });
    await expect(b.servico.detalharOrdem(EMPRESA, ADMIN, 'oc-fora')).rejects.toBeInstanceOf(NotFoundException);
  });
});
