import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import { companyWhere, resolverCompanyId } from './company-resolver';
import {
  oficinaTemOrcamentoAprovado,
} from '../../modules/os/helpers/oficina-orcamento-solicitacao.helper';
import { serviceOrderWhere } from './service-order-resolver';

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

export async function resolveSolicitacaoIdPorProtocoloPg(
  prisma: PrismaService,
  protocolo: string,
): Promise<string | null> {
  const value = texto(protocolo);
  if (!value) return null;

  const row = await prisma.serviceOrder.findFirst({
    where: { protocolo: value },
    select: { id: true, legacyId: true },
  });
  if (!row) return null;
  return row.legacyId ?? row.id;
}

export async function assertOficinaTemOrcamentoNaSolicitacaoPg(
  prisma: PrismaService,
  solicitacaoOsId: string,
  oficinaId: string,
): Promise<void> {
  const solId = texto(solicitacaoOsId);
  const oficina = texto(oficinaId);

  if (!solId) {
    throw new BadRequestException(
      'Vincule o checklist a uma OS com orçamento aprovado.',
    );
  }

  if (!oficina) {
    throw new BadRequestException('oficinaId é obrigatório.');
  }

  const row = await prisma.serviceOrder.findFirst({
    where: serviceOrderWhere(solId),
    select: {
      lances: true,
      oficinaVencedoraId: true,
      status: true,
    },
  });

  if (!row) {
    throw new BadRequestException(
      'Solicitação de OS não encontrada para validar o orçamento.',
    );
  }

  const data = {
    lances: row.lances,
    oficinaVencedoraId: row.oficinaVencedoraId,
    status: row.status,
  } as Record<string, unknown>;

  if (!oficinaTemOrcamentoAprovado(data, oficina)) {
    throw new BadRequestException(
      'Só é possível registrar CHE ou CHD quando o orçamento desta oficina for aprovado pela prefeitura.',
    );
  }
}

export async function loadServiceOrderForChdPg(
  prisma: PrismaService,
  solicitacaoOsId: string,
) {
  return prisma.serviceOrder.findFirst({
    where: serviceOrderWhere(solicitacaoOsId),
    include: {
      company: { select: { id: true, legacyId: true } },
      equipment: { select: { id: true, legacyId: true } },
    },
  });
}

export async function resolveCompanyIdForChdPg(
  prisma: PrismaService,
  prefeituraId: string | null | undefined,
  solicitacaoOsId: string | null | undefined,
): Promise<{ companyId: string; prefeituraLegacyId: string } | null> {
  const pid = texto(prefeituraId);
  if (pid) {
    const companyId = await resolverCompanyId(prisma, pid);
    if (!companyId) return null;
    return { companyId, prefeituraLegacyId: pid };
  }

  const solId = texto(solicitacaoOsId);
  if (!solId) return null;

  const sol = await loadServiceOrderForChdPg(prisma, solId);
  if (!sol) return null;

  return {
    companyId: sol.companyId,
    prefeituraLegacyId: sol.company.legacyId ?? sol.companyId,
  };
}

export async function listServiceOrderPublicIdsPg(
  prisma: PrismaService,
  prefeituraId: string,
): Promise<string[]> {
  const rows = await prisma.serviceOrder.findMany({
    where: { company: companyWhere(prefeituraId) },
    select: { id: true, legacyId: true },
  });

  const ids = new Set<string>();
  for (const row of rows) {
    ids.add(row.id);
    if (row.legacyId) ids.add(row.legacyId);
  }
  return [...ids];
}
