import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AlmoxarifadoService } from '../almoxarifado.service';
import { executarRecebimento, validarEntradaDeRecebimento, type EntradaDeRecebimento, type ItemRecebido } from './recebimento';

const COMPANY = '11111111-1111-1111-1111-111111111111';
const OUTRA = '99999999-9999-9999-9999-999999999999';
const AUTOR = '44444444-4444-4444-4444-444444444444';

type Linha = Record<string, any>;

interface Opcoes {
  statusOc?: string;
  statusOs?: string;
  /** Segunda origem na mesma linha da OC: falta CRÍTICA de outra requisição, pedida depois. */
  origemCritica?: boolean;
  /** A solicitação da falta foi cancelada junto com a requisição (a origem fica sem falta viva). */
  solicitacaoCancelada?: boolean;
  /** Outra falta da mesma peça, sem compra própria, neste depósito (ou em outro). */
  outraFalta?: { depositoId: string };
  /** Linha de reposição de outra peça (`p-0`), ainda sem saldo físico no depósito. */
  linhaDeReposicao?: boolean;
  /** A requisição da falta da origem é de OUTRO depósito que o da OC. */
  requisicaoDaOrigemEmOutroDeposito?: boolean;
  /** A falta da origem é de peça adicional (`origem = 'peca_adicional'`). */
  faltaDePecaAdicional?: boolean;
  /** Roda quando a requisição é travada — simula quem commitou antes da trava. */
  aoTravarRequisicao?: (estado: Estado) => void;
}

type Estado = ReturnType<typeof montarBanco>['estado'];

/**
 * Banco fake que PERSISTE e FILTRA pelos `where` que a produção usa — um
 * `where` que ele não reconhece lança, para um teste nunca passar por um mock
 * que devolve tudo. As CHECKs de `peca_saldos` e de `ordem_compra_itens` que o
 * recebimento pode violar são reproduzidas.
 */
function montarBanco(opts: Opcoes = {}) {
  const log: string[] = [];
  const quando = (d: string) => new Date(d);

  const ocs = new Map<string, Linha>([
    ['oc-1', { id: 'oc-1', companyId: COMPANY, numero: 'OC-2026-001', status: opts.statusOc ?? 'enviada', depositoId: 'dep-1' }],
  ]);
  const ocItens = new Map<string, Linha>([
    ['oci-1', { id: 'oci-1', ordemCompraId: 'oc-1', pecaId: 'p-1', quantidade: opts.origemCritica ? 8 : 5, quantidadeRecebida: 0, valorUnit: 12 }],
  ]);
  const origens = new Map<string, Linha>([
    ['ori-1', { id: 'ori-1', ordemCompraItemId: 'oci-1', solicitacaoCompraItemId: 'sci-1', quantidade: 5, quantidadeRecebida: 0 }],
  ]);
  const scs = new Map<string, Linha>([['sc-1', { id: 'sc-1', status: opts.solicitacaoCancelada ? 'cancelada' : 'aprovada' }]]);
  const scItens = new Map<string, Linha>([
    ['sci-1', {
      id: 'sci-1', solicitacaoId: 'sc-1', pecaId: 'p-1', quantidade: 5, requisicaoItemId: 'ri-1',
      prioridade: 'alta', dataNecessidade: quando('2026-09-20'), createdAt: quando('2026-09-10T10:00:00Z'),
      status: opts.solicitacaoCancelada ? 'cancelada' : 'aberta',
    }],
  ]);
  const reqs = new Map<string, Linha>([
    ['req-1', {
      id: 'req-1', companyId: COMPANY, depositoId: opts.requisicaoDaOrigemEmOutroDeposito ? 'dep-2' : 'dep-1',
      numero: 'REQ-2026-001', serviceOrderId: 'os-1',
      status: opts.solicitacaoCancelada ? 'cancelada' : 'separada',
    }],
  ]);
  const reqItens = new Map<string, Linha>([
    ['ri-1', {
      id: 'ri-1', requisicaoId: 'req-1', pecaId: 'p-1', quantidadeSolicitada: 5, quantidadeReservada: 0,
      status: opts.solicitacaoCancelada ? 'cancelada' : 'faltante', impeditivo: false,
      origem: opts.faltaDePecaAdicional ? 'peca_adicional' : 'plano',
      prioridade: 'alta', dataNecessidade: null, createdAt: quando('2026-09-10T09:00:00Z'),
    }],
    ['ri-2', {
      id: 'ri-2', requisicaoId: 'req-1', pecaId: 'p-9', quantidadeSolicitada: 1, quantidadeReservada: 1,
      status: opts.solicitacaoCancelada ? 'cancelada' : 'separada', impeditivo: true,
      prioridade: 'normal', dataNecessidade: null, createdAt: quando('2026-09-10T09:00:00Z'),
    }],
  ]);
  const oss = new Map<string, Linha>([
    ['os-1', {
      id: 'os-1', companyId: COMPANY, protocolo: 'OS-2026-047', equipmentId: 'eq-1', equipmentNome: 'Retro 01',
      responsavelOperatorId: 'op-1', statusMateriais: opts.statusOs ?? 'compra_em_andamento',
    }],
  ]);
  const saldos = new Map<string, Linha>([
    ['p-1|dep-1', { pecaId: 'p-1', depositoId: 'dep-1', saldoFisico: 0, saldoReservado: 0, saldoSeparado: 0, saldoEmCompra: opts.origemCritica ? 8 : 5 }],
  ]);
  const pecas = new Map<string, Linha>([['p-1', { id: 'p-1', companyId: COMPANY, custoMedio: 10 }]]);

  if (opts.origemCritica) {
    origens.set('ori-2', { id: 'ori-2', ordemCompraItemId: 'oci-1', solicitacaoCompraItemId: 'sci-2', quantidade: 3, quantidadeRecebida: 0 });
    scs.set('sc-2', { id: 'sc-2', status: 'aprovada' });
    scItens.set('sci-2', {
      id: 'sci-2', solicitacaoId: 'sc-2', pecaId: 'p-1', quantidade: 3, requisicaoItemId: 'ri-3',
      // Pedida DEPOIS da `sci-1` e com necessidade mais tarde: só a prioridade a põe na frente.
      prioridade: 'critica', dataNecessidade: quando('2026-09-25'), createdAt: quando('2026-09-11T10:00:00Z'), status: 'aberta',
    });
    reqs.set('req-2', { id: 'req-2', companyId: COMPANY, depositoId: 'dep-1', numero: 'REQ-2026-002', serviceOrderId: 'os-2', status: 'aberta' });
    reqItens.set('ri-3', {
      id: 'ri-3', requisicaoId: 'req-2', pecaId: 'p-1', quantidadeSolicitada: 3, quantidadeReservada: 0, status: 'faltante',
      impeditivo: true, prioridade: 'critica', dataNecessidade: null, createdAt: quando('2026-09-11T09:00:00Z'),
    });
    oss.set('os-2', {
      id: 'os-2', companyId: COMPANY, protocolo: 'OS-2026-050', equipmentId: null, equipmentNome: null,
      responsavelOperatorId: null, statusMateriais: 'compra_em_andamento',
    });
  }

  if (opts.outraFalta) {
    reqs.set('req-3', {
      id: 'req-3', companyId: COMPANY, depositoId: opts.outraFalta.depositoId, numero: 'REQ-2026-003', serviceOrderId: 'os-3', status: 'aberta',
    });
    reqItens.set('ri-5', {
      id: 'ri-5', requisicaoId: 'req-3', pecaId: 'p-1', quantidadeSolicitada: 4, quantidadeReservada: 0, status: 'faltante',
      impeditivo: true, prioridade: 'normal', dataNecessidade: null, createdAt: quando('2026-09-12T09:00:00Z'),
    });
    oss.set('os-3', {
      id: 'os-3', companyId: COMPANY, protocolo: 'OS-2026-060', equipmentId: null, equipmentNome: null,
      responsavelOperatorId: null, statusMateriais: 'aguardando_compra',
    });
  }

  if (opts.linhaDeReposicao) {
    ocItens.set('oci-0', { id: 'oci-0', ordemCompraId: 'oc-1', pecaId: 'p-0', quantidade: 2, quantidadeRecebida: 0, valorUnit: 30 });
    origens.set('ori-0', { id: 'ori-0', ordemCompraItemId: 'oci-0', solicitacaoCompraItemId: 'sci-0', quantidade: 2, quantidadeRecebida: 0 });
    scs.set('sc-0', { id: 'sc-0', status: 'aprovada' });
    scItens.set('sci-0', {
      id: 'sci-0', solicitacaoId: 'sc-0', pecaId: 'p-0', quantidade: 2, requisicaoItemId: null,
      prioridade: 'reposicao', dataNecessidade: null, createdAt: quando('2026-09-09T10:00:00Z'), status: 'aberta',
    });
    pecas.set('p-0', { id: 'p-0', companyId: COMPANY, custoMedio: 0 });
    // Primeira compra da peça neste depósito: a emissão criou a linha só com o `em_compra`.
    saldos.set('p-0|dep-1', { pecaId: 'p-0', depositoId: 'dep-1', saldoFisico: 0, saldoReservado: 0, saldoSeparado: 0, saldoEmCompra: 2 });
  }

  const recebimentos: Linha[] = [];
  const recebimentoItens: Linha[] = [];
  const movimentos: Linha[] = [];
  const auditoria: Linha[] = [];

  const estado = { log, ocs, ocItens, origens, scs, scItens, reqs, reqItens, oss, saldos, pecas, recebimentos, recebimentoItens, movimentos, auditoria };

  const naoReconhecido = (onde: string, arg: unknown): never => {
    throw new Error(`${onde}: where não reconhecido neste fake — ${JSON.stringify(arg)}`);
  };
  const statusDaOc = (ordemCompraItemId: string) => ocs.get(ocItens.get(ordemCompraItemId)!.ordemCompraId)!.status;

  const tx = {
    $queryRaw: jest.fn(async (q: { text: string; values: unknown[] }) => {
      const v = q.values;
      if (q.text.includes('FROM ordens_compra')) {
        log.push('trava:oc');
        const oc = ocs.get(v[0] as string);
        // Sem `company_id` no SQL, o fake não filtra: é o que prova o filtro.
        const filtra = q.text.includes('company_id');
        return oc && (!filtra || oc.companyId === v[1]) ? [{ id: oc.id }] : [];
      }
      if (q.text.includes('FROM requisicoes_material')) {
        log.push(`trava:req:${v[0]}`);
        const r = reqs.get(v[0] as string);
        if (r && opts.aoTravarRequisicao) opts.aoTravarRequisicao(estado);
        const filtra = q.text.includes('company_id');
        return r && (!filtra || r.companyId === v[1]) ? [{ id: r.id }] : [];
      }
      if (q.text.includes('FROM solicitacao_compra_itens')) {
        log.push(`trava:sci:${(v[0] as string[]).join(',')}`);
        return (v[0] as string[]).filter((id) => scItens.has(id)).map((id) => ({ id }));
      }
      if (q.text.includes('FROM peca_saldos')) {
        log.push(`trava:saldo:${v[0]}`);
        return saldos.has(`${v[0]}|${v[1]}`) ? [{ peca_id: v[0] }] : [];
      }
      throw new Error(`SQL não reconhecido: ${q.text}`);
    }),
    $executeRaw: jest.fn(async (q: { text: string; values: unknown[] }) => {
      if (!q.text.includes('UPDATE peca_saldos')) throw new Error(`SQL não reconhecido: ${q.text}`);
      // Lê o OPERADOR de cada coluna no próprio SQL — um fake que aplicasse
      // sinais fixos não veria `saldo_em_compra + x` escrito no lugar de `-`.
      const ops = [...q.text.matchAll(/(saldo_\w+)\s*=\s*\1\s*([+-])/g)].map((m) => [m[1], m[2]] as const);
      if (ops.length !== 3) throw new Error(`UPDATE de saldo fora do formato esperado: ${q.text}`);
      const [pecaId, depositoId] = q.values.slice(3) as [string, string];
      const s = saldos.get(`${pecaId}|${depositoId}`);
      if (!s) return 0;
      const coluna: Record<string, string> = { saldo_fisico: 'saldoFisico', saldo_em_compra: 'saldoEmCompra', saldo_reservado: 'saldoReservado' };
      ops.forEach(([col, sinal], i) => {
        if (!coluna[col]) throw new Error(`coluna inesperada: ${col}`);
        s[coluna[col]] += (sinal === '+' ? 1 : -1) * (q.values[i] as number);
      });
      if (s.saldoEmCompra < 0) throw new Error('CHECK peca_saldos_em_compra_valido');
      if (s.saldoReservado > s.saldoFisico) throw new Error('CHECK peca_saldos_reservado_valido');
      log.push(`saldo:${pecaId}`);
      return 1;
    }),
    ordemCompra: {
      findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => {
        const oc = ocs.get(where.id);
        if (!oc) throw new Error('P2025');
        return {
          ...oc,
          itens: [...ocItens.values()].filter((i) => i.ordemCompraId === oc.id).map((i) => ({
            ...i,
            origens: [...origens.values()].filter((o) => o.ordemCompraItemId === i.id).map((o) => {
              const sci = scItens.get(o.solicitacaoCompraItemId)!;
              return {
                ...o,
                solicitacaoCompraItem: {
                  ...sci,
                  requisicaoItem: sci.requisicaoItemId ? { requisicaoId: reqItens.get(sci.requisicaoItemId)!.requisicaoId } : null,
                },
              };
            }),
          })),
        };
      }),
      updateMany: jest.fn(async ({ where, data }: { where: { id: string; status: string }; data: Linha }) => {
        const oc = ocs.get(where.id);
        if (!oc || oc.status !== where.status) return { count: 0 };
        Object.assign(oc, data);
        return { count: 1 };
      }),
    },
    ordemCompraItem: {
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: { quantidadeRecebida: { increment: number } } }) => {
        const i = ocItens.get(where.id)!;
        i.quantidadeRecebida += data.quantidadeRecebida.increment;
        if (i.quantidadeRecebida > i.quantidade) throw new Error('CHECK oc_item_recebida_ate_quantidade');
        return { ...i };
      }),
      findMany: jest.fn(async ({ where }: { where: { ordemCompraId: string } }) =>
        [...ocItens.values()].filter((i) => i.ordemCompraId === where.ordemCompraId).map((i) => ({ ...i })),
      ),
    },
    ordemCompraItemOrigem: {
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: { quantidadeRecebida: { increment: number } } }) => {
        const o = origens.get(where.id)!;
        o.quantidadeRecebida += data.quantidadeRecebida.increment;
        return { ...o };
      }),
    },
    requisicaoMaterialItem: {
      findMany: jest.fn(async (arg: { where: Linha; select: Linha }) => {
        const { where } = arg;
        if (where.id?.in) {
          return [...reqItens.values()].filter((i) => where.id.in.includes(i.id)).map((i) => {
            const r = reqs.get(i.requisicaoId)!;
            return { ...i, requisicao: { status: r.status, companyId: r.companyId, depositoId: r.depositoId } };
          });
        }
        if (where.pecaId?.in && where.status === 'faltante' && where.requisicao) {
          const filtroSc = arg.select.solicitacaoCompraItens?.where?.status?.not;
          if (filtroSc !== 'cancelada') naoReconhecido('solicitacaoCompraItens', arg.select);
          return [...reqItens.values()]
            .filter((i) => where.pecaId.in.includes(i.pecaId) && i.status === 'faltante')
            .filter((i) => {
              const r = reqs.get(i.requisicaoId)!;
              return r.companyId === where.requisicao.companyId
                && r.depositoId === where.requisicao.depositoId
                && !where.requisicao.status.notIn.includes(r.status);
            })
            .map((i) => ({
              ...i,
              solicitacaoCompraItens: [...scItens.values()].filter((s) => s.requisicaoItemId === i.id && s.status !== 'cancelada'),
            }));
        }
        return naoReconhecido('requisicaoMaterialItem.findMany', where);
      }),
      updateMany: jest.fn(async ({ where, data }: { where: { id: string; status: string }; data: Linha }) => {
        const i = reqItens.get(where.id);
        if (!i || i.status !== where.status) return { count: 0 };
        i.quantidadeReservada += data.quantidadeReservada.increment;
        if (data.status) i.status = data.status;
        return { count: 1 };
      }),
    },
    solicitacaoCompraItem: {
      findMany: jest.fn(async ({ where }: { where: Linha }) => {
        if (where.requisicaoItemId?.in) {
          if (where.status?.not !== 'cancelada') naoReconhecido('solicitacaoCompraItem.findMany', where);
          return [...scItens.values()]
            .filter((s) => where.requisicaoItemId.in.includes(s.requisicaoItemId) && s.status !== 'cancelada')
            .map((s) => ({
              requisicaoItemId: s.requisicaoItemId,
              origensOc: [...origens.values()].filter((o) => o.solicitacaoCompraItemId === s.id).map((o) => ({
                quantidade: o.quantidade,
                quantidadeRecebida: o.quantidadeRecebida,
                ordemCompraItem: { ordemCompra: { status: statusDaOc(o.ordemCompraItemId) } },
              })),
            }));
        }
        if (where.id?.in) {
          return [...scItens.values()]
            .filter((s) => where.id.in.includes(s.id))
            .filter((s) => where.status === undefined || s.status === where.status)
            .map((s) => ({
              ...s,
              origensOc: [...origens.values()].filter((o) => o.solicitacaoCompraItemId === s.id).map((o) => ({ ...o })),
            }));
        }
        return naoReconhecido('solicitacaoCompraItem.findMany', where);
      }),
      updateMany: jest.fn(async ({ where, data }: { where: { id: string; status: string }; data: Linha }) => {
        const s = scItens.get(where.id);
        if (!s || s.status !== where.status) return { count: 0 };
        Object.assign(s, data);
        return { count: 1 };
      }),
    },
    solicitacaoCompra: {
      findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => {
        const sc = scs.get(where.id)!;
        return {
          status: sc.status,
          itens: [...scItens.values()].filter((s) => s.solicitacaoId === sc.id).map((s) => ({
            status: s.status,
            quantidade: s.quantidade,
            origensOc: [...origens.values()].filter((o) => o.solicitacaoCompraItemId === s.id).map((o) => ({
              quantidade: o.quantidade,
              quantidadeRecebida: o.quantidadeRecebida,
              ordemCompraItem: { ordemCompra: { status: statusDaOc(o.ordemCompraItemId) } },
            })),
          })),
        };
      }),
      updateMany: jest.fn(async ({ where, data }: { where: { id: string; status: string }; data: Linha }) => {
        const sc = scs.get(where.id);
        if (!sc || sc.status !== where.status) return { count: 0 };
        Object.assign(sc, data);
        return { count: 1 };
      }),
    },
    recebimento: {
      create: jest.fn(async ({ data }: { data: Linha }) => {
        const r = { id: `rec-${recebimentos.length + 1}`, ...data };
        recebimentos.push(r);
        return { id: r.id };
      }),
    },
    recebimentoItem: {
      create: jest.fn(async ({ data }: { data: Linha }) => {
        recebimentoItens.push({ ...data });
        return data;
      }),
    },
    pecaSaldo: {
      findUniqueOrThrow: jest.fn(async ({ where }: { where: { pecaId_depositoId: { pecaId: string; depositoId: string } } }) => {
        const s = saldos.get(`${where.pecaId_depositoId.pecaId}|${where.pecaId_depositoId.depositoId}`);
        if (!s) throw new Error('P2025');
        return { ...s };
      }),
    },
    peca: {
      findFirstOrThrow: jest.fn(async ({ where }: { where: { id: string; companyId: string } }) => {
        const p = pecas.get(where.id);
        if (!p || p.companyId !== where.companyId) throw new Error('P2025');
        return { ...p };
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Linha }) => {
        Object.assign(pecas.get(where.id)!, data);
        return {};
      }),
    },
    estoqueMovimento: {
      create: jest.fn(async ({ data }: { data: Linha }) => {
        movimentos.push({ ...data });
        return data;
      }),
    },
    requisicaoMaterial: {
      updateMany: jest.fn(async ({ where, data }: { where: { id: string; status: string }; data: Linha }) => {
        const r = reqs.get(where.id);
        if (!r || r.status !== where.status) return { count: 0 };
        Object.assign(r, data);
        return { count: 1 };
      }),
      findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => {
        const r = reqs.get(where.id)!;
        return {
          ...r,
          itens: [...reqItens.values()].filter((i) => i.requisicaoId === r.id).map((i) => ({ ...i })),
          serviceOrder: { ...oss.get(r.serviceOrderId)! },
        };
      }),
    },
    serviceOrder: {
      updateMany: jest.fn(async ({ where, data }: { where: { id: string; companyId: string }; data: Linha }) => {
        const os = oss.get(where.id);
        if (!os || os.companyId !== where.companyId) return { count: 0 };
        Object.assign(os, data);
        log.push(`os:${where.id}`);
        return { count: 1 };
      }),
    },
    equipmentProgramador: {
      findMany: jest.fn(async ({ where }: { where: { equipmentId: string } }) =>
        where.equipmentId === 'eq-1' ? [{ companyUserId: 'cu-prog' }] : [],
      ),
    },
    companyRole: {
      findMany: jest.fn(async ({ where }: { where: Linha }) =>
        where.companyId === COMPANY && where.accessGroups.some.group.key === 'almoxarifado' ? [{ id: 'role-alm' }] : [],
      ),
    },
    operator: {
      findMany: jest.fn(async ({ where }: { where: Linha }) =>
        where.companyRoleId.in.includes('role-alm') ? [{ companyUserId: 'cu-alm' }] : [],
      ),
      findFirst: jest.fn(async ({ where }: { where: { id: string; companyId: string } }) =>
        where.id === 'op-1' && where.companyId === COMPANY ? { companyUserId: 'cu-mec' } : null,
      ),
    },
    company: { findUnique: jest.fn(async () => ({ legacyId: 'leg-1' })) },
    companyUser: {
      findFirst: jest.fn(async ({ where }: { where: { id: string; companyId: string } }) =>
        where.id === AUTOR && where.companyId === COMPANY ? { name: 'Almoxarife', email: 'alm@vrental.com' } : null,
      ),
    },
    pontoAuditoria: {
      create: jest.fn(async ({ data }: { data: Linha }) => {
        auditoria.push({ ...data });
        return data;
      }),
    },
  };

  return { tx, estado };
}

function linha(parcial: Partial<ItemRecebido> & { ordemCompraItemId: string }): ItemRecebido {
  return {
    quantidadeRecebida: 0,
    quantidadeRecusada: 0,
    valorUnit: null,
    lote: null,
    validade: null,
    divergencia: null,
    ...parcial,
  };
}

function entrada(itens: ItemRecebido[], companyId = COMPANY): EntradaDeRecebimento {
  return {
    companyId,
    autorCompanyUserId: AUTOR,
    ordemCompraId: 'oc-1',
    notaFiscalNumero: 'NF 123',
    notaFiscalChave: null,
    observacao: null,
    itens,
  };
}

describe('executarRecebimento — o que fica gravado', () => {
  it('a falta inteira chega: saldo, razão, custo, reserva, conferência reaberta, OC recebida, SC atendida, OS destravada e avisos', async () => {
    const { tx, estado } = montarBanco();

    const { resultado, notificacoes } = await executarRecebimento(
      tx as never,
      entrada([linha({ ordemCompraItemId: 'oci-1', quantidadeRecebida: 5, lote: 'L-77' })]),
    );

    expect(resultado).toEqual({ recebimentoId: 'rec-1', statusOrdemCompra: 'recebida' });
    expect(estado.saldos.get('p-1|dep-1')).toMatchObject({ saldoFisico: 5, saldoEmCompra: 0, saldoReservado: 5 });
    expect(estado.movimentos).toEqual([expect.objectContaining({
      companyId: COMPANY, pecaId: 'p-1', depositoId: 'dep-1', tipo: 'entrada', quantidade: 5, saldoApos: 5,
      custoUnit: 12, origemTipo: 'recebimento', origemId: 'rec-1', autorCompanyUserId: AUTOR, observacao: 'OC-2026-001',
    })]);
    // Saldo anterior zero: a média vira o preço da entrada.
    expect(estado.pecas.get('p-1')!.custoMedio).toBe(12);
    expect(estado.recebimentos).toEqual([expect.objectContaining({
      companyId: COMPANY, ordemCompraId: 'oc-1', depositoId: 'dep-1', notaFiscalNumero: 'NF 123', recebidoPorCompanyUserId: AUTOR,
    })]);
    expect(estado.recebimentoItens).toEqual([expect.objectContaining({
      recebimentoId: 'rec-1', ordemCompraItemId: 'oci-1', quantidadeRecebida: 5, quantidadeRecusada: 0, lote: 'L-77', divergencia: null,
    })]);

    expect(estado.reqItens.get('ri-1')).toMatchObject({ status: 'reservada', quantidadeReservada: 5 });
    expect(estado.reqs.get('req-1')!.status).toBe('em_separacao');
    expect(estado.ocs.get('oc-1')!.status).toBe('recebida');
    expect(estado.ocItens.get('oci-1')!.quantidadeRecebida).toBe(5);
    expect(estado.origens.get('ori-1')!.quantidadeRecebida).toBe(5);
    expect(estado.scItens.get('sci-1')!.status).toBe('atendida');
    expect(estado.oss.get('os-1')!.statusMateriais).toBe('aguardando_separacao');

    expect(estado.auditoria).toEqual([expect.objectContaining({
      companyId: COMPANY, acao: 'recebimento.registrar', alvoTipo: 'suprimentos.recebimento', alvoId: 'rec-1', atorId: AUTOR,
    })]);

    expect(notificacoes.map((n) => [n.destinatarioId, n.titulo, n.referenciaTipo])).toEqual([
      ['cu-prog', 'OS-2026-047: peça chegou', 'service_order'],
      ['cu-mec', 'OS-2026-047: peça chegou', 'service_order'],
      ['cu-alm', 'Kit da REQ-2026-001 a conferir', 'requisicao_material'],
    ]);
  });

  it('trava na ordem única: OC → requisições → itens de solicitação → saldo → OS', async () => {
    const { tx, estado } = montarBanco();
    await executarRecebimento(tx as never, entrada([linha({ ordemCompraItemId: 'oci-1', quantidadeRecebida: 5 })]));
    expect(estado.log).toEqual(['trava:oc', 'trava:req:req-1', 'trava:sci:sci-1', 'trava:saldo:p-1', 'saldo:p-1', 'os:os-1']);
  });

  it('parte da falta chega: item continua faltante com a reserva parcial, kit NÃO reabre, OS em recebimento parcial', async () => {
    const { tx, estado } = montarBanco();

    const { resultado, notificacoes } = await executarRecebimento(
      tx as never,
      entrada([linha({ ordemCompraItemId: 'oci-1', quantidadeRecebida: 2, valorUnit: 11 })]),
    );

    expect(resultado.statusOrdemCompra).toBe('recebida_parcial');
    expect(estado.saldos.get('p-1|dep-1')).toMatchObject({ saldoFisico: 2, saldoEmCompra: 3, saldoReservado: 2 });
    expect(estado.reqItens.get('ri-1')).toMatchObject({ status: 'faltante', quantidadeReservada: 2 });
    expect(estado.reqs.get('req-1')!.status).toBe('separada');
    expect(estado.scItens.get('sci-1')!.status).toBe('aberta');
    expect(estado.oss.get('os-1')!.statusMateriais).toBe('recebimento_parcial');
    // Preço da nota vale sobre o da OC.
    expect(estado.movimentos[0]).toMatchObject({ quantidade: 2, custoUnit: 11 });
    expect(estado.pecas.get('p-1')!.custoMedio).toBe(11);
    expect(notificacoes.map((n) => [n.destinatarioId, n.titulo])).toEqual([
      ['cu-prog', 'OS-2026-047: chegou parte das peças'],
      ['cu-alm', 'REQ-2026-001: chegou parte das peças'],
    ]);
  });

  it('quem pediu: duas origens na mesma linha — a crítica recebe antes, mesmo pedida depois', async () => {
    const { tx, estado } = montarBanco({ origemCritica: true });

    await executarRecebimento(tx as never, entrada([linha({ ordemCompraItemId: 'oci-1', quantidadeRecebida: 3 })]));

    expect(estado.origens.get('ori-2')!.quantidadeRecebida).toBe(3);
    expect(estado.origens.get('ori-1')!.quantidadeRecebida).toBe(0);
    expect(estado.reqItens.get('ri-3')).toMatchObject({ status: 'reservada', quantidadeReservada: 3 });
    expect(estado.reqItens.get('ri-1')).toMatchObject({ status: 'faltante', quantidadeReservada: 0 });
    expect(estado.saldos.get('p-1|dep-1')).toMatchObject({ saldoFisico: 3, saldoReservado: 3, saldoEmCompra: 5 });
    // As duas requisições travadas, em ordem de id.
    expect(estado.log.filter((l) => l.startsWith('trava:req'))).toEqual(['trava:req:req-1', 'trava:req:req-2']);
  });

  it('quem precisa: origem sem falta viva (solicitação cancelada) — a peça vai para outra falta da mesma peça no depósito', async () => {
    const { tx, estado } = montarBanco({ solicitacaoCancelada: true, outraFalta: { depositoId: 'dep-1' } });

    await executarRecebimento(tx as never, entrada([linha({ ordemCompraItemId: 'oci-1', quantidadeRecebida: 5 })]));

    // A OC entregou à origem dela; a reserva foi para quem precisava.
    expect(estado.origens.get('ori-1')!.quantidadeRecebida).toBe(5);
    expect(estado.reqItens.get('ri-5')).toMatchObject({ status: 'reservada', quantidadeReservada: 4 });
    expect(estado.saldos.get('p-1|dep-1')).toMatchObject({ saldoFisico: 5, saldoReservado: 4, saldoEmCompra: 0 });
    expect(estado.oss.get('os-3')!.statusMateriais).toBe('aguardando_separacao');
    expect(estado.reqItens.get('ri-1')!.status).toBe('cancelada');
  });

  it('falta de OUTRO depósito não recebe a peça — fica livre na prateleira', async () => {
    const { tx, estado } = montarBanco({ solicitacaoCancelada: true, outraFalta: { depositoId: 'dep-2' } });

    await executarRecebimento(tx as never, entrada([linha({ ordemCompraItemId: 'oci-1', quantidadeRecebida: 5 })]));

    expect(estado.reqItens.get('ri-5')).toMatchObject({ status: 'faltante', quantidadeReservada: 0 });
    expect(estado.saldos.get('p-1|dep-1')).toMatchObject({ saldoFisico: 5, saldoReservado: 0 });
    expect(estado.oss.get('os-3')!.statusMateriais).toBe('aguardando_compra');
  });

  it('falta da origem numa requisição de OUTRO depósito não recebe reserva — o saldo é do depósito da OC', async () => {
    const { tx, estado } = montarBanco({ requisicaoDaOrigemEmOutroDeposito: true });

    await executarRecebimento(tx as never, entrada([linha({ ordemCompraItemId: 'oci-1', quantidadeRecebida: 5 })]));

    expect(estado.origens.get('ori-1')!.quantidadeRecebida).toBe(5);
    expect(estado.reqItens.get('ri-1')).toMatchObject({ status: 'faltante', quantidadeReservada: 0 });
    expect(estado.saldos.get('p-1|dep-1')).toMatchObject({ saldoFisico: 5, saldoReservado: 0, saldoEmCompra: 0 });
  });

  it('decide pela falta relida DEPOIS da trava: quem reservou antes dela não recebe de novo', async () => {
    const { tx, estado } = montarBanco({
      // Commitou entre a leitura de fora e a trava: a falta já foi coberta.
      aoTravarRequisicao: (e) => Object.assign(e.reqItens.get('ri-1')!, { status: 'reservada', quantidadeReservada: 5 }),
    });

    await executarRecebimento(tx as never, entrada([linha({ ordemCompraItemId: 'oci-1', quantidadeRecebida: 5 })]));

    expect(estado.saldos.get('p-1|dep-1')).toMatchObject({ saldoFisico: 5, saldoReservado: 0 });
    expect(estado.reqItens.get('ri-1')).toMatchObject({ status: 'reservada', quantidadeReservada: 5 });
    expect(estado.reqs.get('req-1')!.status).toBe('separada');
  });

  it('duas peças: saldo travado em ordem de peça, reposição fica livre', async () => {
    const { tx, estado } = montarBanco({ linhaDeReposicao: true });

    // Entrada na ordem inversa da de trava.
    await executarRecebimento(tx as never, entrada([
      linha({ ordemCompraItemId: 'oci-1', quantidadeRecebida: 5 }),
      linha({ ordemCompraItemId: 'oci-0', quantidadeRecebida: 2 }),
    ]));

    expect(estado.log.filter((l) => l.startsWith('trava:saldo'))).toEqual(['trava:saldo:p-0', 'trava:saldo:p-1']);
    expect(estado.saldos.get('p-0|dep-1')).toMatchObject({ saldoFisico: 2, saldoReservado: 0, saldoEmCompra: 0 });
    expect(estado.pecas.get('p-0')!.custoMedio).toBe(30);
    expect(estado.scItens.get('sci-0')!.status).toBe('atendida');
    expect(estado.ocs.get('oc-1')!.status).toBe('recebida');
  });

  it('linha de saldo ausente numa OC emitida é estado quebrado: lança antes de mexer no saldo', async () => {
    const { tx, estado } = montarBanco();
    estado.saldos.delete('p-1|dep-1');

    await expect(executarRecebimento(tx as never, entrada([linha({ ordemCompraItemId: 'oci-1', quantidadeRecebida: 5 })])))
      .rejects.toThrow('estado inconsistente');
    expect(estado.movimentos).toEqual([]);
    expect(estado.saldos.has('p-1|dep-1')).toBe(false);
  });

  it('só recusa: nada entra no estoque, o pedido não é consumido e a OC não muda', async () => {
    const { tx, estado } = montarBanco();

    const { resultado } = await executarRecebimento(tx as never, entrada([
      linha({ ordemCompraItemId: 'oci-1', quantidadeRecusada: 2, divergencia: 'Filtro errado' }),
    ]));

    expect(resultado.statusOrdemCompra).toBe('enviada');
    expect(estado.ocs.get('oc-1')!.status).toBe('enviada');
    expect(estado.saldos.get('p-1|dep-1')).toMatchObject({ saldoFisico: 0, saldoEmCompra: 5 });
    expect(estado.movimentos).toEqual([]);
    expect(estado.ocItens.get('oci-1')!.quantidadeRecebida).toBe(0);
    expect(estado.recebimentoItens).toEqual([expect.objectContaining({
      quantidadeRecebida: 0, quantidadeRecusada: 2, divergencia: 'Filtro errado',
    })]);
    expect(estado.oss.get('os-1')!.statusMateriais).toBe('compra_em_andamento');
  });

  it('peça adicional que chega tira a OS de aguardando peça adicional e avisa', async () => {
    const { tx, estado } = montarBanco({ statusOs: 'aguardando_peca_adicional', faltaDePecaAdicional: true });

    const { notificacoes } = await executarRecebimento(
      tx as never,
      entrada([linha({ ordemCompraItemId: 'oci-1', quantidadeRecebida: 5 })]),
    );

    expect(estado.oss.get('os-1')!.statusMateriais).toBe('aguardando_separacao');
    expect(notificacoes.map((n) => n.titulo)).toContain('OS-2026-047: peça chegou');
  });

  it('parte da peça adicional chega: recebimento parcial, não aguardando compra', async () => {
    const { tx, estado } = montarBanco({ statusOs: 'aguardando_peca_adicional', faltaDePecaAdicional: true });

    await executarRecebimento(tx as never, entrada([linha({ ordemCompraItemId: 'oci-1', quantidadeRecebida: 2 })]));

    expect(estado.oss.get('os-1')!.statusMateriais).toBe('recebimento_parcial');
  });

  it('OS fora de estado de compra não é rebaixada pela peça que chegou', async () => {
    const { tx, estado } = montarBanco({ statusOs: 'em_execucao' });

    const { notificacoes } = await executarRecebimento(
      tx as never,
      entrada([linha({ ordemCompraItemId: 'oci-1', quantidadeRecebida: 5 })]),
    );

    expect(estado.oss.get('os-1')!.statusMateriais).toBe('em_execucao');
    expect(estado.log).not.toContain('os:os-1');
    expect(notificacoes).toEqual([]);
  });

  it('recebido acima do pendente: 400 e nada gravado', async () => {
    const { tx, estado } = montarBanco();

    await expect(executarRecebimento(tx as never, entrada([linha({ ordemCompraItemId: 'oci-1', quantidadeRecebida: 6 })])))
      .rejects.toBeInstanceOf(BadRequestException);

    expect(estado.recebimentos).toEqual([]);
    expect(estado.saldos.get('p-1|dep-1')).toMatchObject({ saldoFisico: 0, saldoEmCompra: 5 });
    expect(estado.movimentos).toEqual([]);
  });

  it('linha de outra OC: 400', async () => {
    const { tx } = montarBanco();
    await expect(executarRecebimento(tx as never, entrada([linha({ ordemCompraItemId: 'oci-x', quantidadeRecebida: 1 })])))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it.each(['rascunho', 'aguardando_aprovacao', 'recebida', 'encerrada', 'cancelada'])(
    'OC "%s" não aceita recebimento (estado relido depois da trava)',
    async (status) => {
      const { tx, estado } = montarBanco({ statusOc: status });
      await expect(executarRecebimento(tx as never, entrada([linha({ ordemCompraItemId: 'oci-1', quantidadeRecebida: 1 })])))
        .rejects.toBeInstanceOf(ConflictException);
      expect(estado.recebimentos).toEqual([]);
    },
  );

  it('OC de outra empresa: 404', async () => {
    const { tx, estado } = montarBanco();
    await expect(executarRecebimento(tx as never, entrada([linha({ ordemCompraItemId: 'oci-1', quantidadeRecebida: 1 })], OUTRA)))
      .rejects.toThrow(new NotFoundException('Ordem de compra não encontrada para esta empresa.'));
    // Barrada na trava da OC — antes de tocar requisição ou saldo.
    expect(estado.log).toEqual(['trava:oc']);
    expect(estado.recebimentos).toEqual([]);
  });
});

describe('validarEntradaDeRecebimento', () => {
  const ok = linha({ ordemCompraItemId: 'oci-1', quantidadeRecebida: 1 });

  it('aceita o pedido bem formado', () => {
    expect(() => validarEntradaDeRecebimento(entrada([ok]))).not.toThrow();
  });

  it.each([
    ['sem itens', []],
    ['linha repetida', [ok, ok]],
    ['quantidade negativa', [linha({ ordemCompraItemId: 'a', quantidadeRecebida: -1 })]],
    ['NaN', [linha({ ordemCompraItemId: 'a', quantidadeRecebida: Number.NaN })]],
    ['linha sem recebido nem recusado', [linha({ ordemCompraItemId: 'a' })]],
    ['recusa sem divergência', [linha({ ordemCompraItemId: 'a', quantidadeRecusada: 1, divergencia: '  ' })]],
  ])('recusa %s', (_nome, itens) => {
    expect(() => validarEntradaDeRecebimento(entrada(itens as ItemRecebido[]))).toThrow(BadRequestException);
  });
});

describe('AlmoxarifadoService.receberOrdemDeCompra', () => {
  function servico(statusOc: string | null) {
    const { tx, estado } = montarBanco();
    const ordem: string[] = [];
    const prisma = {
      ordemCompra: {
        findFirst: jest.fn(async ({ where }: { where: { id: string; companyId: string } }) =>
          statusOc && where.companyId === COMPANY ? { status: statusOc } : null,
        ),
      },
      $transaction: jest.fn(async (fn: (t: unknown) => Promise<unknown>) => {
        const r = await fn(tx);
        ordem.push('commit');
        return r;
      }),
      notificacao: {
        createMany: jest.fn(async () => {
          ordem.push('notificacao');
          return { count: 1 };
        }),
      },
    };
    return { svc: new AlmoxarifadoService(prisma as never), prisma, estado, ordem, tx };
  }

  it('avisa depois do commit, com o client normal, e não devolve as notificações na resposta', async () => {
    const { svc, prisma, ordem, tx } = servico('enviada');

    const r = await svc.receberOrdemDeCompra(entrada([linha({ ordemCompraItemId: 'oci-1', quantidadeRecebida: 5 })]));

    expect(r).toEqual({ recebimentoId: 'rec-1', statusOrdemCompra: 'recebida' });
    expect(ordem).toEqual(['commit', 'notificacao']);
    expect(prisma.notificacao.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([expect.objectContaining({ destinatarioId: 'cu-alm' })]),
    });
    expect((tx as Record<string, unknown>).notificacao).toBeUndefined();
  });

  it('pedido malformado não abre transação', async () => {
    const { svc, prisma } = servico('enviada');
    await expect(svc.receberOrdemDeCompra(entrada([]))).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.ordemCompra.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('OC inexistente para a empresa: 404 sem transação; OC em rascunho: 409 sem transação', async () => {
    const semOc = servico(null);
    await expect(semOc.svc.receberOrdemDeCompra(entrada([linha({ ordemCompraItemId: 'oci-1', quantidadeRecebida: 1 })])))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(semOc.prisma.$transaction).not.toHaveBeenCalled();

    const rascunho = servico('rascunho');
    await expect(rascunho.svc.receberOrdemDeCompra(entrada([linha({ ordemCompraItemId: 'oci-1', quantidadeRecebida: 1 })])))
      .rejects.toBeInstanceOf(ConflictException);
    expect(rascunho.prisma.$transaction).not.toHaveBeenCalled();
  });
});
