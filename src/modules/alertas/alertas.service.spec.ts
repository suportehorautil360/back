jest.mock('../../common/prisma/company-resolver', () => ({
  resolverCompanyId: jest.fn().mockResolvedValue('company-uuid'),
}));

jest.mock('../../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { resolverCompanyId } from '../../common/prisma/company-resolver';
import type { PrismaService } from '../../prisma/prisma.service';
import { AlertasService, type FlagsAlertas } from './alertas.service';

const mockedResolver = jest.mocked(resolverCompanyId);

const TODAS: FlagsAlertas = { revisao: true, cnh: true, tanque: true };

function emDias(dias: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + dias);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function makePrisma(data: {
  equipamentos?: Array<Record<string, unknown>>;
  operadores?: Array<Record<string, unknown>>;
  comboios?: Array<Record<string, unknown>>;
  companyId?: string | null;
}) {
  const companyId = data.companyId ?? 'company-uuid';
  const prisma = {
    equipment: { findMany: jest.fn() },
    operator: { findMany: jest.fn() },
  };

  let equipmentCall = 0;
  prisma.equipment.findMany.mockImplementation(async () => {
    equipmentCall += 1;
    if (data.comboios?.length && equipmentCall > 1) {
      return data.comboios;
    }
    return data.equipamentos ?? data.comboios ?? [];
  });

  prisma.operator.findMany.mockImplementation(async (args: { where?: { companyId?: string } }) => {
    if (args?.where?.companyId !== companyId) return [];
    return data.operadores ?? [];
  });

  return prisma as unknown as PrismaService;
}

const mail = { habilitado: () => false, enviar: jest.fn() } as never;

describe('AlertasService.coletar', () => {
  beforeEach(() => {
    mockedResolver.mockResolvedValue('company-uuid');
  });

  it('detecta revisão vencida (uso >= intervalo) e calcula o excedente', async () => {
    const prisma = makePrisma({
      equipamentos: [
        {
          descricao: 'Trator',
          placa: 'ABC-1234',
          medicaoAtual: 1200,
          ultimaRevisao: 0,
          intervaloRevisao: 1000,
          unidadeRevisao: 'h',
          status: 'ativo',
        },
        {
          descricao: 'Em dia',
          medicaoAtual: 500,
          ultimaRevisao: 0,
          intervaloRevisao: 1000,
          status: 'ativo',
        },
      ],
    });
    const r = await new AlertasService(prisma, mail).coletar('p1', TODAS);
    expect(r.revisoes).toHaveLength(1);
    expect(r.revisoes[0].descricao).toBe('Trator');
    expect(r.revisoes[0].excedente).toBe(200);
  });

  it('ignora equipamento inativo', async () => {
    const prisma = makePrisma({
      equipamentos: [
        {
          status: 'inativo',
          medicaoAtual: 5000,
          ultimaRevisao: 0,
          intervaloRevisao: 1000,
        },
      ],
    });
    const r = await new AlertasService(prisma, mail).coletar('p1', TODAS);
    expect(r.revisoes).toHaveLength(0);
  });

  it('detecta CNH a vencer em <= 30 dias e ignora as longe/sem CNH', async () => {
    const prisma = makePrisma({
      operadores: [
        { nome: 'João', cnhValidade: emDias(10), cnhCategoria: 'D' },
        { nome: 'Vencida', cnhValidade: emDias(-5) },
        { nome: 'Longe', cnhValidade: emDias(200) },
        { nome: 'SemCnh', cnhValidade: null },
      ],
    });
    const r = await new AlertasService(prisma, mail).coletar('p1', TODAS);
    expect(r.cnhs.map((c) => c.nome).sort()).toEqual(['João', 'Vencida']);
  });

  it('detecta tanque <= 20% e calcula o percentual', async () => {
    const prisma = makePrisma({
      comboios: [
        {
          tipo: 'Comboio',
          descricao: 'T1',
          capacidadeTanque: 1000,
          volumeTanqueAtual: 150,
          combustivel: 'diesel',
        },
        {
          tipo: 'Comboio',
          descricao: 'T2',
          capacidadeTanque: 1000,
          volumeTanqueAtual: 800,
          combustivel: 'diesel',
        },
      ],
    });
    const r = await new AlertasService(prisma, mail).coletar('p1', TODAS);
    expect(r.tanques.map((t) => t.nome)).toEqual(['T1']);
    expect(r.tanques[0].percentual).toBe(15);
  });

  it('respeita as flags desligadas', async () => {
    const prisma = makePrisma({
      comboios: [
        {
          tipo: 'Comboio',
          descricao: 'T1',
          capacidadeTanque: 1000,
          volumeTanqueAtual: 50,
        },
      ],
    });
    const r = await new AlertasService(prisma, mail).coletar('p1', {
      revisao: true,
      cnh: true,
      tanque: false,
    });
    expect(r.tanques).toHaveLength(0);
  });
});
