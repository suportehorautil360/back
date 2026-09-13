import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  INTERCEPTORS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { IdempotencyInterceptor } from '../../../common/idempotency.interceptor';
import { MODULO_COMERCIAL_KEY } from '../../../common/modulo-comercial.decorator';
import { PainelGuard, type RequestComPainel } from '../../../common/painel.guard';
import { ComprasController } from './compras.controller';
import type { ComprasService } from './compras.service';

const prototipo = ComprasController.prototype as unknown as Record<string, object>;

/** As rotas lidas da METADATA do Nest — não de uma lista escrita à mão. */
function rotas() {
  return Object.getOwnPropertyNames(ComprasController.prototype)
    .filter((nome) => nome !== 'constructor')
    .map((nome) => ({
      nome,
      verbo: Reflect.getMetadata(METHOD_METADATA, prototipo[nome]) as RequestMethod | undefined,
      caminho: Reflect.getMetadata(PATH_METADATA, prototipo[nome]) as string | undefined,
    }))
    .filter((r): r is { nome: string; verbo: RequestMethod; caminho: string } => r.verbo !== undefined);
}

describe('ComprasController — o contrato de rotas que o painel consome', () => {
  it('expõe exatamente as 16 rotas do contrato', () => {
    expect(rotas().map((r) => `${RequestMethod[r.verbo]} ${r.caminho}`).sort()).toEqual(
      [
        'GET solicitacoes',
        'GET solicitacoes/:id',
        'POST solicitacoes',
        'POST solicitacoes/:id/rejeitar',
        'POST solicitacoes/:id/cancelar',
        'GET ordens',
        'GET ordens/:id',
        'POST ordens',
        'PATCH ordens/:id',
        'PUT ordens/:id/itens',
        'POST ordens/:id/confirmar',
        'POST ordens/:id/aprovar',
        'POST ordens/:id/devolver',
        'POST ordens/:id/enviar',
        'POST ordens/:id/cancelar',
        'POST ordens/:id/encerrar',
      ].sort(),
    );
  });

  it('toda rota que não é GET leva o IdempotencyInterceptor — uma rota de escrita nova sem ele reprova aqui', () => {
    // A lista de escrita sai da metadata, então esquecer o decorator numa rota
    // NOVA também é pego — não só nas doze de hoje.
    const escrita = rotas().filter((r) => r.verbo !== RequestMethod.GET);
    expect(escrita).toHaveLength(12);
    const semInterceptor = escrita
      .filter((r) => {
        const interceptors = (Reflect.getMetadata(INTERCEPTORS_METADATA, prototipo[r.nome]) ?? []) as unknown[];
        return !interceptors.includes(IdempotencyInterceptor);
      })
      .map((r) => `${RequestMethod[r.verbo]} ${r.caminho}`);
    expect(semInterceptor).toEqual([]);
  });

  it('a classe responde em /compras, atrás do PainelGuard e do gate suprimentos/compras, e nenhuma rota troca o gate', () => {
    expect(Reflect.getMetadata(PATH_METADATA, ComprasController)).toBe('compras');
    expect(Reflect.getMetadata(GUARDS_METADATA, ComprasController)).toContain(PainelGuard);
    expect(Reflect.getMetadata(MODULO_COMERCIAL_KEY, ComprasController)).toEqual({
      featureKey: 'suprimentos',
      accessGroupKey: 'compras',
    });
    for (const r of rotas()) {
      expect(Reflect.getMetadata(MODULO_COMERCIAL_KEY, prototipo[r.nome])).toBeUndefined();
    }
  });
});

describe('ComprasController — empresa e autor vêm do token, nunca do corpo', () => {
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
      criarSolicitacao: jest.fn(async (_input: unknown) => ({ id: 'x', numero: 'SC' })),
      criarOrdem: jest.fn(async (_input: unknown) => ({ id: 'x', numero: 'OC' })),
      substituirItens: jest.fn(async (_input: unknown) => ({})),
      aprovarOrdem: jest.fn(async (_input: unknown) => ({})),
      cancelarSolicitacao: jest.fn(async (_input: unknown) => ({})),
    };
    return { servico, controller: new ComprasController(servico as unknown as ComprasService) };
  }

  it('criar solicitação e criar ordem ignoram companyId/autor forjados no corpo', async () => {
    const { servico, controller } = montar();
    await controller.criarSolicitacao(req, {
      depositoId: 'dep', prioridade: 'alta', justificativa: 'Reposição', itens: [{ pecaId: 'p', quantidade: 1 }],
      companyId: 'forjada', solicitanteCompanyUserId: 'forjado',
    } as never);
    await controller.criarOrdem(req, {
      partnerId: 'forn', depositoId: 'dep', companyId: 'forjada', criadaPorCompanyUserId: 'forjado',
    } as never);

    for (const chamada of [servico.criarSolicitacao.mock.calls[0], servico.criarOrdem.mock.calls[0]]) {
      expect(chamada[0]).toEqual(
        expect.objectContaining({ companyId: 'empresa-do-token', autorCompanyUserId: 'usuario-do-token' }),
      );
      expect(JSON.stringify(chamada)).not.toContain('forjad');
    }
  });

  it('atos sobre um documento usam o id da ROTA e o autor do token', async () => {
    const { servico, controller } = montar();
    await controller.aprovarOrdem(req, 'oc-da-rota');
    await controller.cancelarSolicitacao(req, 'sc-da-rota', { motivo: 'Não precisa mais', companyId: 'forjada' } as never);
    await controller.substituirItens(req, 'oc-da-rota', {
      itens: [{ pecaId: 'p', valorUnit: 1, origens: [{ solicitacaoCompraItemId: 'i', quantidade: 1 }] }],
      ordemCompraId: 'forjada',
    } as never);

    expect(servico.aprovarOrdem).toHaveBeenCalledWith({
      companyId: 'empresa-do-token', ordemCompraId: 'oc-da-rota', autorCompanyUserId: 'usuario-do-token',
    });
    expect(servico.cancelarSolicitacao).toHaveBeenCalledWith({
      companyId: 'empresa-do-token', solicitacaoId: 'sc-da-rota', autorCompanyUserId: 'usuario-do-token', motivo: 'Não precisa mais',
    });
    expect(servico.substituirItens).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: 'empresa-do-token', ordemCompraId: 'oc-da-rota', autorCompanyUserId: 'usuario-do-token' }),
    );
  });
});
