import { ParceirosService } from './parceiros.service';

/**
 * Desde a F4, `PartnerType` tem FORNECEDOR (cadastrado pelo setor de compras
 * da empresa). O overview da rede credenciada separava por "é POSTO, senão é
 * oficina" — um fornecedor aparecia como oficina.
 *
 * O fake de `partner.findMany` FILTRA por `where.type.in` de verdade: um mock
 * que devolvesse sempre as três linhas não provaria o filtro da consulta.
 */
function montar() {
  const linhas = [
    { id: 'p-posto', type: 'POSTO', companyId: 'c1', company: { legacyId: 'leg-1' } },
    { id: 'p-oficina', type: 'OFICINA', companyId: 'c1', company: { legacyId: 'leg-1' } },
    { id: 'p-fornecedor', type: 'FORNECEDOR', companyId: 'c1', company: { legacyId: 'leg-1' } },
  ].map((l) => ({
    ...l,
    razaoSocial: `Razão ${l.id}`, nomeFantasia: null, cidadeUf: null, bandeira: null, especialidade: null,
    condicaoPagamento: null, limiteCredito: null, ativo: true, status: 'ativo',
  }));
  const prisma = {
    company: { findMany: jest.fn(async () => [{ id: 'c1', legacyId: 'leg-1', name: 'Empresa', uf: 'SP' }]) },
    partner: {
      findMany: jest.fn(async (args: { where?: { type?: { in?: string[] } } }) =>
        linhas.filter((l) => !args?.where?.type?.in || args.where.type.in.includes(l.type)),
      ),
    },
  };
  return { servico: new ParceirosService(prisma as never), prisma };
}

describe('ParceirosService.overview — fornecedor não é da rede', () => {
  it('fornecedor não aparece nem como posto nem como oficina', async () => {
    const { servico } = montar();
    const { data } = await servico.overview();
    const ids = [...data.postos, ...data.oficinas].map((p) => p.id);
    expect(ids).toContain('p-posto');
    expect(ids).toContain('p-oficina');
    expect(ids).not.toContain('p-fornecedor');
    expect(data.oficinas.map((o) => o.id)).toEqual(['p-oficina']);
  });

  it('a consulta já pede só posto e oficina ao banco', async () => {
    const { servico, prisma } = montar();
    await servico.overview();
    expect(prisma.partner.findMany.mock.calls[0][0]).toMatchObject({ where: { type: { in: ['POSTO', 'OFICINA'] } } });
  });
});
