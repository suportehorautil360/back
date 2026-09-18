import { NotFoundException, RequestMethod } from '@nestjs/common';
import { INTERCEPTORS_METADATA, METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { MODULO_COMERCIAL_KEY } from '../../common/modulo-comercial.decorator';
import { IdempotencyInterceptor } from '../../common/idempotency.interceptor';
import type { RequestComPainel } from '../../common/painel.guard';
import { AlmoxarifadoController } from './almoxarifado.controller';
import type { AlmoxarifadoService } from './almoxarifado.service';

/**
 * O gate de cada rota é a metadata que o `PainelGuard` lê — primeiro a da
 * rota, depois a da classe (`painel.guard.ts`, e `painel.guard.spec.ts` prova
 * essa precedência). Aqui se prova QUAL metadata cada rota carrega.
 */
describe('AlmoxarifadoController — gate por rota', () => {
  it('reservar exige o grupo de quem ABRE a OS (manutencao), não o do almoxarife', () => {
    // Fundação da F4: com o gate da classe, todo programador sem o grupo
    // `almoxarifado` levava 403 na reserva — a OS nascia em análise, sem falta
    // detectada e sem solicitação de compra.
    expect(Reflect.getMetadata(MODULO_COMERCIAL_KEY, AlmoxarifadoController.prototype.reservar))
      .toEqual({ featureKey: 'suprimentos', accessGroupKey: 'manutencao' });
  });

  it('as demais rotas de escrita continuam no gate da classe (almoxarifado)', () => {
    expect(Reflect.getMetadata(MODULO_COMERCIAL_KEY, AlmoxarifadoController))
      .toEqual({ featureKey: 'suprimentos', accessGroupKey: 'almoxarifado' });
    for (const rota of [
      'entrada', 'separar', 'liberar', 'entregar', 'cancelar',
      // F4: quem recebe do fornecedor e quem confere o estoque mínimo é o
      // almoxarife — o gate da classe basta.
      'receber', 'recebimentosPendentes', 'verificarEstoqueMinimo',
    ] as const) {
      expect(Reflect.getMetadata(MODULO_COMERCIAL_KEY, AlmoxarifadoController.prototype[rota]))
        .toBeUndefined();
    }
  });

  it('peça adicional é do grupo mecanica — quem pede é a bancada, não o almoxarife', () => {
    for (const rota of ['pedirPecaAdicional', 'pecasAdicionais'] as const) {
      expect(Reflect.getMetadata(MODULO_COMERCIAL_KEY, AlmoxarifadoController.prototype[rota]))
        .toEqual({ featureKey: 'suprimentos', accessGroupKey: 'mecanica' });
    }
  });

  it('toda rota que escreve saldo carrega a chave de idempotência; a verificação de mínimo não precisa', () => {
    const temInterceptor = (rota: keyof AlmoxarifadoController) =>
      ((Reflect.getMetadata(INTERCEPTORS_METADATA, AlmoxarifadoController.prototype[rota]) ?? []) as unknown[])
        .some((i) => i === IdempotencyInterceptor);
    for (const rota of [
      'reservar', 'entrada', 'separar', 'liberar', 'entregar', 'cancelar', 'receber', 'pedirPecaAdicional',
      // Task 8: os quatro atos da transferência mexem em saldo (expedir,
      // receber) ou em documento (criar, cancelar) — reenvio de rede sem a
      // chave repetiria o efeito.
      'criarTransferencia', 'expedirTransferencia', 'receberTransferencia', 'cancelarTransferencia',
    ] as const) {
      expect(temInterceptor(rota)).toBe(true);
    }
    // Idempotente por construção: o índice único parcial deixa existir no
    // máximo uma reposição automática aberta por peça e depósito.
    expect(temInterceptor('verificarEstoqueMinimo')).toBe(false);
  });
});

/**
 * Task 8: as quatro rotas da transferência entre depósitos — mesmo molde de
 * `compras/compras.controller.spec.ts` ("o contrato de rotas" e "empresa e
 * autor vêm do token").
 */
describe('AlmoxarifadoController — rotas de transferência (Task 8)', () => {
  const prototipo = AlmoxarifadoController.prototype as unknown as Record<string, object>;
  const ROTAS = ['criarTransferencia', 'expedirTransferencia', 'receberTransferencia', 'cancelarTransferencia'] as const;

  it('cada handler carrega o verbo e o caminho certos — não só o CONJUNTO dos quatro', () => {
    // Comparar as duas listas ORDENADAS (`.sort()`) prova só que o conjunto de
    // rotas bate — trocar os decorators de `expedir` e `receber` entre si
    // deixaria essa lista igual, e em produção a rota de "expedir" passaria a
    // rodar o RECEBIMENTO. Por isso: handler a handler, cada nome contra o
    // verbo+caminho que ELE especificamente carrega.
    const rotaDe = (nome: (typeof ROTAS)[number]) => {
      const verbo = Reflect.getMetadata(METHOD_METADATA, prototipo[nome]) as RequestMethod;
      const caminho = Reflect.getMetadata(PATH_METADATA, prototipo[nome]) as string;
      return `${RequestMethod[verbo]} ${caminho}`;
    };
    expect(rotaDe('criarTransferencia')).toBe('POST transferencias');
    expect(rotaDe('expedirTransferencia')).toBe('POST transferencias/:id/expedir');
    expect(rotaDe('receberTransferencia')).toBe('POST transferencias/:id/receber');
    expect(rotaDe('cancelarTransferencia')).toBe('POST transferencias/:id/cancelar');
  });

  it('nenhuma das quatro sobrescreve o gate da classe (almoxarifado): mover peça é ofício do almoxarife nas duas pontas', () => {
    for (const nome of ROTAS) {
      expect(Reflect.getMetadata(MODULO_COMERCIAL_KEY, prototipo[nome])).toBeUndefined();
    }
  });

  it('expedir, receber e cancelar exigem UUID em `:id` — malformado vira 400, não um 500 cru (achado da revisão final)', () => {
    // Mesmo motivo do irmão `compras/compras.controller.ts`: sem o pipe, um
    // id malformado chega inteiro ao `::uuid` da trava (`$queryRaw` de
    // `expedirTransferencia`/`receberTransferencia`/`cancelarTransferencia`),
    // e o Postgres devolve `invalid input syntax for type uuid` — 500 cru,
    // não 400. `criarTransferencia` fica de fora: não tem `:id`, monta um
    // documento novo.
    for (const nome of ['expedirTransferencia', 'receberTransferencia', 'cancelarTransferencia'] as const) {
      const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, AlmoxarifadoController, nome) as
        | Record<string, { data?: unknown; pipes?: unknown[] }>
        | undefined;
      const paramId = Object.values(args ?? {}).find((a) => a.data === 'id');
      expect(paramId).toBeDefined();
      const nomesDosPipes = (paramId!.pipes ?? []).map(
        (p) => (p as { constructor?: { name?: string } })?.constructor?.name ?? (p as { name?: string })?.name,
      );
      expect(nomesDosPipes).toContain('ParseUUIDPipe');
    }
  });

  const req = {
    painel: {
      companyId: 'empresa-do-token',
      companyUserId: 'usuario-do-token',
      operatorId: null,
      companyRoleId: null,
      nomeExibicao: 'Quem pede',
    },
  } as unknown as RequestComPainel;

  function montar() {
    const servico = {
      criarTransferencia: jest.fn(async (_i: unknown) => ({ id: 'trf-1', numero: 'TRF-2026-001', itens: 1 })),
      expedirTransferencia: jest.fn(async (_i: unknown) => ({ transferenciaId: 'trf-1', numero: 'TRF-2026-001', itens: 1 })),
      receberTransferencia: jest.fn(async (_i: unknown) => ({ transferenciaId: 'trf-1', numero: 'TRF-2026-001', comDivergencia: 0 })),
      cancelarTransferencia: jest.fn(async (_i: unknown) => ({ transferenciaId: 'trf-1', numero: 'TRF-2026-001' })),
    };
    return { servico, controller: new AlmoxarifadoController(servico as unknown as AlmoxarifadoService) };
  }

  it('criar transferência ignora companyId/autor forjados no corpo — os dois vêm do token', async () => {
    const { servico, controller } = montar();
    await controller.criarTransferencia(req, {
      depositoOrigemId: 'dep-a',
      depositoDestinoId: 'dep-b',
      itens: [{ pecaId: 'p-1', quantidade: 2 }],
      observacao: 'Reforço',
      companyId: 'forjada',
      autorCompanyUserId: 'forjado',
    } as never);

    expect(servico.criarTransferencia).toHaveBeenCalledWith({
      companyId: 'empresa-do-token',
      depositoOrigemId: 'dep-a',
      depositoDestinoId: 'dep-b',
      itens: [{ pecaId: 'p-1', quantidade: 2 }],
      autorCompanyUserId: 'usuario-do-token',
      observacao: 'Reforço',
    });
    expect(JSON.stringify(servico.criarTransferencia.mock.calls[0])).not.toContain('forjad');
  });

  it('expedir/receber/cancelar usam o id da ROTA e o autor do token — nunca o companyId forjado no corpo', async () => {
    const { servico, controller } = montar();
    await controller.expedirTransferencia(req, 'trf-da-rota');
    await controller.receberTransferencia(req, 'trf-da-rota', {
      itens: [{ itemId: 'ti-1', quantidadeRecebida: 4 }],
      companyId: 'forjada',
    } as never);
    await controller.cancelarTransferencia(req, 'trf-da-rota', {
      motivo: 'Pedido duplicado',
      companyId: 'forjada',
    } as never);

    expect(servico.expedirTransferencia).toHaveBeenCalledWith({
      companyId: 'empresa-do-token', transferenciaId: 'trf-da-rota', autorCompanyUserId: 'usuario-do-token',
    });
    expect(servico.receberTransferencia).toHaveBeenCalledWith({
      companyId: 'empresa-do-token',
      transferenciaId: 'trf-da-rota',
      autorCompanyUserId: 'usuario-do-token',
      itens: [{ itemId: 'ti-1', quantidadeRecebida: 4, motivoDivergencia: null }],
    });
    expect(servico.cancelarTransferencia).toHaveBeenCalledWith({
      companyId: 'empresa-do-token', transferenciaId: 'trf-da-rota', autorCompanyUserId: 'usuario-do-token', motivo: 'Pedido duplicado',
    });
    for (const chamada of [
      servico.expedirTransferencia.mock.calls[0],
      servico.receberTransferencia.mock.calls[0],
      servico.cancelarTransferencia.mock.calls[0],
    ]) {
      expect(JSON.stringify(chamada)).not.toContain('forjad');
    }
  });

  it('receber TRANSMITE o motivoDivergencia preenchido ao serviço — não só o ausente→null', async () => {
    // Trocar `i.motivoDivergencia ?? null` por `null` fixo passava verde no
    // teste acima (o único caso exercitado era justamente o ausente). Sem
    // este segundo caso, quem digita o motivo da divergência levaria um 400
    // do ato ("chegou em quantidade menor, diga por quê") que nunca
    // conseguiria satisfazer, porque o motivo seria descartado no caminho.
    const { servico, controller } = montar();
    await controller.receberTransferencia(req, 'trf-da-rota', {
      itens: [{ itemId: 'ti-1', quantidadeRecebida: 3, motivoDivergencia: 'Avaria no transporte' }],
    } as never);

    expect(servico.receberTransferencia).toHaveBeenCalledWith({
      companyId: 'empresa-do-token',
      transferenciaId: 'trf-da-rota',
      autorCompanyUserId: 'usuario-do-token',
      itens: [{ itemId: 'ti-1', quantidadeRecebida: 3, motivoDivergencia: 'Avaria no transporte' }],
    });
  });

  it('transferência de outra empresa (404) propaga pela rota — a exceção de domínio não vira 200', async () => {
    const { servico, controller } = montar();
    servico.expedirTransferencia = jest.fn(async () => {
      throw new NotFoundException('Transferência não encontrada nesta empresa.');
    });
    await expect(controller.expedirTransferencia(req, 'trf-de-outra-empresa')).rejects.toThrow(NotFoundException);

    servico.cancelarTransferencia = jest.fn(async () => {
      throw new NotFoundException('Transferência não encontrada nesta empresa.');
    });
    await expect(
      controller.cancelarTransferencia(req, 'trf-de-outra-empresa', { motivo: 'x' } as never),
    ).rejects.toThrow(NotFoundException);
  });
});
