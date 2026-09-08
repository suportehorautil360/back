import { NotFoundException } from '@nestjs/common';
import { MecanicaService } from './mecanica.service';
import type { PainelPayload } from '../../common/painel.guard';

const PAINEL: PainelPayload = {
  companyUserId: 'user-1',
  companyId: 'empresa-1',
  operatorId: 'op-1',
  companyRoleId: 'cargo-1',
};

/**
 * Prisma falso que APLICA o `where` recebido sobre uma tabela em memória.
 * Um stub que devolve lista fixa passaria mesmo com o filtro apagado — que é
 * exatamente o defeito que estes testes existem para pegar.
 */
function prismaCom(linhas: Record<string, unknown>[]) {
  const casa = (linha: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => linha[k] === v);
  return {
    serviceOrder: {
      findMany: jest.fn(({ where }) => Promise.resolve(linhas.filter((l) => casa(l, where)))),
      findFirst: jest.fn(({ where }) =>
        Promise.resolve(linhas.find((l) => casa(l, where)) ?? null),
      ),
    },
  } as never;
}

const LINHAS = [
  { id: 'os-interna', companyId: 'empresa-1', execucao: 'interna', responsavelOperatorId: null },
  { id: 'os-parceira', companyId: 'empresa-1', execucao: 'parceira', responsavelOperatorId: null },
  { id: 'os-outra-empresa', companyId: 'empresa-2', execucao: 'interna', responsavelOperatorId: null },
  { id: 'os-de-outro', companyId: 'empresa-1', execucao: 'interna', responsavelOperatorId: 'op-9' },
];

describe('MecanicaService.listarBancada', () => {
  it('devolve só OS interna da empresa do token', async () => {
    const s = new MecanicaService(prismaCom(LINHAS));
    const r = await s.listarBancada(PAINEL, false);
    expect(r.map((o) => o.id).sort()).toEqual(['os-de-outro', 'os-interna']);
  });

  it('nunca devolve OS parceira', async () => {
    const s = new MecanicaService(prismaCom(LINHAS));
    const r = await s.listarBancada(PAINEL, false);
    expect(r.some((o) => o.id === 'os-parceira')).toBe(false);
  });

  it('nunca devolve OS de outra empresa', async () => {
    const s = new MecanicaService(prismaCom(LINHAS));
    const r = await s.listarBancada(PAINEL, false);
    expect(r.some((o) => o.id === 'os-outra-empresa')).toBe(false);
  });

  it('com apenasMinhas, recorta pelo responsável do token', async () => {
    const s = new MecanicaService(prismaCom(LINHAS));
    const r = await s.listarBancada(PAINEL, true);
    expect(r).toEqual([]);
  });
});

describe('MecanicaService.detalhe', () => {
  it('404 para OS de outra empresa', async () => {
    const s = new MecanicaService(prismaCom(LINHAS));
    await expect(s.detalhe(PAINEL, 'os-outra-empresa')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('404 para OS parceira — não existe para este módulo', async () => {
    const s = new MecanicaService(prismaCom(LINHAS));
    await expect(s.detalhe(PAINEL, 'os-parceira')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('devolve a OS interna da empresa', async () => {
    const s = new MecanicaService(prismaCom(LINHAS));
    await expect(s.detalhe(PAINEL, 'os-interna')).resolves.toMatchObject({
      id: 'os-interna',
    });
  });
});
