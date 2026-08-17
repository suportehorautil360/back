import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { resolverCompanyId } from '../../common/prisma/company-resolver';
import { PrismaService } from '../../prisma/prisma.service';
import type { Notificacao } from '../../prisma/generated/client';
import {
  CreateNotificacaoDto,
  DestinatarioTipo,
  NotificacaoTipo,
} from './dto/create-notificacao.dto';

export interface NotificacaoDoc {
  id: string;
  destinatarioTipo: DestinatarioTipo;
  destinatarioId: string;
  prefeituraId: string;
  titulo: string;
  mensagem: string;
  tipo: NotificacaoTipo;
  referenciaTipo?: string | null;
  referenciaId?: string | null;
  lida: boolean;
  createdAt: string;
  updatedAt: string;
}

function mapNotificacaoRow(row: Notificacao): NotificacaoDoc {
  return {
    id: row.legacyId ?? row.id,
    destinatarioTipo: row.destinatarioTipo as DestinatarioTipo,
    destinatarioId: row.destinatarioId,
    prefeituraId: row.prefeituraLegacyId,
    titulo: row.titulo,
    mensagem: row.mensagem,
    tipo: row.tipo as NotificacaoTipo,
    referenciaTipo: row.referenciaTipo,
    referenciaId: row.referenciaId,
    lida: row.lida,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class NotificacoesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateNotificacaoDto): Promise<NotificacaoDoc> {
    const id = randomUUID();
    const companyId = await resolverCompanyId(this.prisma, dto.prefeituraId);
    if (!companyId) {
      throw new InternalServerErrorException('Empresa não encontrada.');
    }

    try {
      const row = await this.prisma.notificacao.create({
        data: {
          id,
          legacyId: id,
          companyId,
          destinatarioTipo: dto.destinatarioTipo,
          destinatarioId: dto.destinatarioId,
          prefeituraLegacyId: dto.prefeituraId,
          titulo: dto.titulo,
          mensagem: dto.mensagem,
          tipo: dto.tipo ?? 'info',
          referenciaTipo: dto.referenciaTipo ?? null,
          referenciaId: dto.referenciaId ?? null,
          lida: false,
        },
      });
      return mapNotificacaoRow(row);
    } catch (e) {
      console.error('Erro ao criar notificação:', e);
      throw new InternalServerErrorException(
        'Não foi possível criar a notificação.',
      );
    }
  }

  async listar(destinatarioTipo: DestinatarioTipo, destinatarioId: string) {
    try {
      const rows = await this.prisma.notificacao.findMany({
        where: { destinatarioTipo, destinatarioId },
        orderBy: { createdAt: 'desc' },
      });
      const data = rows.map(mapNotificacaoRow);
      return { data, message: 'Notificações carregadas.' };
    } catch (e) {
      console.error('Erro ao listar notificações:', e);
      throw new InternalServerErrorException(
        'Não foi possível listar as notificações.',
      );
    }
  }

  async marcarLida(id: string) {
    const row = await this.prisma.notificacao.findFirst({
      where: { OR: [{ id }, { legacyId: id }] },
    });
    if (!row) {
      throw new NotFoundException('Notificação não encontrada.');
    }
    await this.prisma.notificacao.update({
      where: { id: row.id },
      data: { lida: true },
    });
    return {
      data: { id: row.legacyId ?? row.id },
      message: 'Notificação marcada como lida.',
    };
  }

  async marcarTodasLidas(
    destinatarioTipo: DestinatarioTipo,
    destinatarioId: string,
  ) {
    const result = await this.prisma.notificacao.updateMany({
      where: { destinatarioTipo, destinatarioId, lida: false },
      data: { lida: true },
    });
    if (result.count === 0) {
      return { data: { atualizadas: 0 }, message: 'Tudo lido.' };
    }
    return {
      data: { atualizadas: result.count },
      message: 'Notificações marcadas como lidas.',
    };
  }
}
