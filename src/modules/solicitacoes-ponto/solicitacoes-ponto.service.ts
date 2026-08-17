import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { selarRegistroPostgres } from '../../common/prisma/ponto-selo.helper';
import {
  resolverCompanyId,
  resolverEmpresa,
} from '../../common/prisma/company-resolver';
import { PrismaService } from '../../prisma/prisma.service';
import type { PontoSolicitacao } from '../../prisma/generated/client';
import {
  CreateSolicitacaoPontoDto,
  TipoBatida,
  TipoSolicitacao,
} from './dto/create-solicitacao-ponto.dto';
import { NotificacoesService } from '../notificacoes/notificacoes.service';
import { AbonosService } from '../abonos/abonos.service';

export type StatusSolicitacao = 'pendente' | 'aprovado' | 'reprovado';

export interface SolicitacaoDoc {
  id: string;
  tipo: TipoSolicitacao;
  status: StatusSolicitacao;
  prefeituraId: string;
  name: string;
  cpf?: string | null;
  batidaId?: string | null;
  data?: string | null;
  timestampOriginal?: string | null;
  tipoBatida?: TipoBatida | null;
  observacao?: string | null;
  anexoDataUrl?: string | null;
  anexoNome?: string | null;
  motivoReprovacao?: string | null;
  createdAt: string;
  updatedAt: string;
}

function mapSolicitacaoRow(
  row: PontoSolicitacao,
  prefeituraId: string,
): SolicitacaoDoc {
  return {
    id: row.legacyId ?? row.id,
    tipo: row.tipo as TipoSolicitacao,
    status: row.status as StatusSolicitacao,
    prefeituraId,
    name: row.operatorNome,
    cpf: row.operatorCpf,
    batidaId: row.batidaId,
    data: row.data,
    timestampOriginal: row.timestampOriginal?.toISOString() ?? null,
    tipoBatida: (row.tipoBatida as TipoBatida | null) ?? null,
    observacao: row.observacao,
    anexoDataUrl: row.anexoDataUrl,
    anexoNome: row.anexoNome,
    motivoReprovacao: row.motivoReprovacao,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class SolicitacoesPontoService {
  constructor(
    private readonly prisma: PrismaService,
    private notificacoes: NotificacoesService,
    private abonos: AbonosService,
  ) {}

  private rotuloTipo(tipo: TipoSolicitacao): string {
    return {
      incluir: 'Incluir batida',
      cancelar: 'Cancelar batida',
      abono: 'Solicitar abono',
      mensagem: 'Mensagem',
    }[tipo];
  }

  async create(dto: CreateSolicitacaoPontoDto) {
    try {
      const id = randomUUID();
      const companyId = await resolverCompanyId(this.prisma, dto.prefeituraId);
      if (!companyId) {
        throw new InternalServerErrorException('Empresa não encontrada.');
      }

      const cpfDigits = (dto.cpf ?? '').replace(/\D/g, '') || null;
      let operatorId: string | null = null;
      if (cpfDigits) {
        const op = await this.prisma.operator.findFirst({
          where: { companyId, cpf: cpfDigits },
          select: { id: true },
        });
        operatorId = op?.id ?? null;
      }

      const row = await this.prisma.pontoSolicitacao.create({
        data: {
          id,
          legacyId: id,
          companyId,
          operatorId,
          operatorNome: dto.name,
          operatorCpf: cpfDigits,
          tipo: dto.tipo,
          status: 'pendente',
          batidaId: dto.batidaId ?? null,
          data: dto.data ?? null,
          timestampOriginal: dto.timestampOriginal
            ? new Date(dto.timestampOriginal)
            : null,
          tipoBatida: dto.tipoBatida ?? null,
          observacao: dto.observacao ?? null,
          anexoDataUrl: dto.anexoDataUrl ?? null,
          anexoNome: dto.anexoNome ?? null,
        },
      });
      const doc = mapSolicitacaoRow(row, dto.prefeituraId);

      try {
        await this.notificacoes.create({
          destinatarioTipo: 'rh',
          destinatarioId: dto.prefeituraId,
          prefeituraId: dto.prefeituraId,
          tipo: 'info',
          titulo: `Nova solicitação: ${this.rotuloTipo(dto.tipo)}`,
          mensagem: `${dto.name} enviou uma solicitação${
            dto.observacao ? `: "${dto.observacao.slice(0, 120)}"` : '.'
          }`,
          referenciaTipo: 'solicitacao-ponto',
          referenciaId: doc.id,
        });
      } catch (notifErr) {
        console.warn('Não foi possível notificar RH:', notifErr);
      }

      return { data: doc, message: 'Solicitação registrada.' };
    } catch (e) {
      if (e instanceof InternalServerErrorException) throw e;
      console.error('Erro ao criar solicitação de ponto:', e);
      throw new InternalServerErrorException(
        'Não foi possível registrar a solicitação.',
      );
    }
  }

  async listar(prefeituraId: string) {
    try {
      const companyId = await resolverCompanyId(this.prisma, prefeituraId);
      if (!companyId) {
        return { data: [] as SolicitacaoDoc[], message: 'Solicitações carregadas.' };
      }

      const rows = await this.prisma.pontoSolicitacao.findMany({
        where: { companyId },
        orderBy: { createdAt: 'desc' },
      });
      const data = rows.map((row) => mapSolicitacaoRow(row, prefeituraId));
      return { data, message: 'Solicitações carregadas.' };
    } catch (e) {
      console.error('Erro ao listar solicitações de ponto:', e);
      throw new InternalServerErrorException(
        'Não foi possível listar as solicitações.',
      );
    }
  }

  async aprovar(id: string) {
    const row = await this.prisma.pontoSolicitacao.findFirst({
      where: { OR: [{ id }, { legacyId: id }] },
    });
    if (!row) {
      throw new NotFoundException('Solicitação não encontrada.');
    }

    const company = await this.prisma.company.findUnique({
      where: { id: row.companyId },
      select: { legacyId: true },
    });
    const prefeituraId = company?.legacyId ?? row.companyId;
    const doc = mapSolicitacaoRow(row, prefeituraId);

    if (doc.status !== 'pendente') {
      return { data: doc, message: 'Solicitação já foi avaliada.' };
    }

    try {
      if (doc.tipo === 'incluir' && doc.timestampOriginal) {
        const batidaId = randomUUID();
        const ts = doc.timestampOriginal;
        const tipoBatida: TipoBatida = doc.tipoBatida ?? 'entrada';
        const identificador =
          (doc.cpf ?? '').replace(/\D/g, '') || doc.name;

        await this.prisma.$transaction(async (tx) => {
          const selo = await selarRegistroPostgres(tx, row.companyId, {
            identificador,
            tipo: tipoBatida,
            timestampOriginal: ts,
            registro: 'ajuste',
            refNsr: null,
          });

          await tx.pontoRegistro.create({
            data: {
              id: batidaId,
              legacyId: batidaId,
              companyId: row.companyId,
              operatorId: row.operatorId,
              operatorNome: doc.name,
              operatorCpf: (doc.cpf ?? '').replace(/\D/g, '') || null,
              timestampOriginal: new Date(ts),
              tipo: tipoBatida,
              registro: 'ajuste',
              refNsr: null,
              nsr: selo.nsr,
              hash: selo.hash,
              hashAnterior: selo.hashAnterior || null,
              aplicado: true,
            },
          });
        });
      } else if (doc.tipo === 'cancelar' && doc.batidaId) {
        const alvo = await this.prisma.pontoRegistro.findFirst({
          where: {
            companyId: row.companyId,
            OR: [{ id: doc.batidaId }, { legacyId: doc.batidaId }],
          },
        });

        if (alvo) {
          const cancelId = randomUUID();
          const identificador =
            alvo.operatorCpf?.replace(/\D/g, '') || alvo.operatorNome;

          await this.prisma.$transaction(async (tx) => {
            const selo = await selarRegistroPostgres(tx, row.companyId, {
              identificador,
              tipo: alvo.tipo,
              timestampOriginal: alvo.timestampOriginal.toISOString(),
              registro: 'cancelamento',
              refNsr: alvo.nsr,
            });

            await tx.pontoRegistro.create({
              data: {
                id: cancelId,
                legacyId: cancelId,
                companyId: row.companyId,
                operatorId: alvo.operatorId,
                operatorNome: alvo.operatorNome,
                operatorCpf: alvo.operatorCpf,
                timestampOriginal: alvo.timestampOriginal,
                tipo: alvo.tipo,
                registro: 'cancelamento',
                refNsr: alvo.nsr,
                refId: alvo.legacyId ?? alvo.id,
                nsr: selo.nsr,
                hash: selo.hash,
                hashAnterior: selo.hashAnterior || null,
                aplicado: true,
              },
            });
          });
        }
      } else if (doc.tipo === 'abono' && doc.data) {
        let cpf = (doc.cpf ?? '').replace(/\D/g, '');
        if (!cpf && doc.name?.trim()) {
          try {
            const op = await this.prisma.operator.findFirst({
              where: {
                companyId: row.companyId,
                nome: { equals: doc.name.trim(), mode: 'insensitive' },
              },
              select: { cpf: true },
            });
            cpf = (op?.cpf ?? '').replace(/\D/g, '');
          } catch (lookupErr) {
            console.warn('Falha ao resolver CPF do operador:', lookupErr);
          }
        }
        if (cpf) {
          try {
            await this.abonos.criar({
              prefeituraId,
              funcionarioCpf: cpf,
              funcionarioNome: doc.name,
              data: doc.data,
              motivo: doc.observacao ?? null,
              solicitacaoId: doc.id,
            });
          } catch (abonoErr) {
            console.warn('Não foi possível criar abono:', abonoErr);
          }
        } else {
          console.warn(
            `Abono aprovado SEM criar registro: CPF não encontrado (solicitação ${doc.id}, "${doc.name}").`,
          );
        }
      }

      const updatedRow = await this.prisma.pontoSolicitacao.update({
        where: { id: row.id },
        data: {
          status: 'aprovado',
          motivoReprovacao: null,
        },
      });
      const updated = mapSolicitacaoRow(updatedRow, prefeituraId);

      if (doc.cpf) {
        try {
          await this.notificacoes.create({
            destinatarioTipo: 'funcionario',
            destinatarioId: doc.cpf,
            prefeituraId,
            tipo: 'sucesso',
            titulo: `${this.rotuloTipo(doc.tipo)} aprovada`,
            mensagem: 'Sua solicitação foi aprovada pelo gestor.',
            referenciaTipo: 'solicitacao-ponto',
            referenciaId: doc.id,
          });
        } catch (notifErr) {
          console.warn('Não foi possível notificar funcionário:', notifErr);
        }
      }

      return { data: updated, message: 'Solicitação aprovada.' };
    } catch (e) {
      if (e instanceof NotFoundException) throw e;
      console.error('Erro ao aprovar solicitação:', e);
      throw new InternalServerErrorException(
        'Não foi possível aprovar a solicitação.',
      );
    }
  }

  async reprovar(id: string, motivo: string) {
    const row = await this.prisma.pontoSolicitacao.findFirst({
      where: { OR: [{ id }, { legacyId: id }] },
    });
    if (!row) {
      throw new NotFoundException('Solicitação não encontrada.');
    }

    const company = await resolverEmpresa(this.prisma, row.companyId, {
      id: true,
      legacyId: true,
    });
    const prefeituraId = company?.legacyId ?? row.companyId;
    const doc = mapSolicitacaoRow(row, prefeituraId);

    if (doc.status !== 'pendente') {
      return { data: doc, message: 'Solicitação já foi avaliada.' };
    }

    try {
      const updatedRow = await this.prisma.pontoSolicitacao.update({
        where: { id: row.id },
        data: {
          status: 'reprovado',
          motivoReprovacao: motivo?.trim() || null,
        },
      });
      const updated = mapSolicitacaoRow(updatedRow, prefeituraId);

      if (doc.cpf) {
        try {
          await this.notificacoes.create({
            destinatarioTipo: 'funcionario',
            destinatarioId: doc.cpf,
            prefeituraId,
            tipo: 'aviso',
            titulo: `${this.rotuloTipo(doc.tipo)} reprovada`,
            mensagem: motivo?.trim()
              ? `Motivo: ${motivo.trim()}`
              : 'Sua solicitação foi reprovada pelo gestor.',
            referenciaTipo: 'solicitacao-ponto',
            referenciaId: doc.id,
          });
        } catch (notifErr) {
          console.warn('Não foi possível notificar funcionário:', notifErr);
        }
      }

      return { data: updated, message: 'Solicitação reprovada.' };
    } catch (e) {
      console.error('Erro ao reprovar solicitação:', e);
      throw new InternalServerErrorException(
        'Não foi possível reprovar a solicitação.',
      );
    }
  }
}
