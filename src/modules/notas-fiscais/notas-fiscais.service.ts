import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../prisma/generated/client';
import { randomUUID } from 'node:crypto';
import { resolverCompanyId } from '../../common/prisma/company-resolver';
import { PrismaService } from '../../prisma/prisma.service';
import { UploadsService } from '../uploads/uploads.service';
import type { ListNotasFiscaisPrefeituraQueryDto } from './dto/list-notas-fiscais-prefeitura-query.dto';
import {
  mapNotaFiscalRowToApi,
} from './helpers/nota-fiscal-response.helper';
import {
  buildOsResolucaoMaps,
  enriquecerNotaFiscalPrefeitura,
  filtrarNotasFiscaisPrefeitura,
  type NotaFiscalPrefeituraListItem,
} from './helpers/notas-fiscais-prefeitura.helper';
import { calcularResumoNotasFiscais } from './helpers/notas-fiscais-resumo.helper';
import { parseDanfePdf } from './helpers/parse-danfe-pdf.helper';
import type { ParsedDanfeData } from './helpers/parse-danfe-pdf.helper';
import {
  NOTA_FISCAL_STATUS,
  type NotaFiscalApiItem,
  type NotaFiscalStatus,
} from './notas-fiscais.types';

const MAX_PDF_BYTES = 10 * 1024 * 1024;

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

function parseValorInformado(raw: unknown): number {
  if (raw == null || String(raw).trim() === '') {
    throw new BadRequestException('Informe o valor total da nota (R$).');
  }
  const normalizado = String(raw)
    .trim()
    .replace(/\s/g, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '')
    .replace(',', '.');
  const n = Number(normalizado);
  if (!Number.isFinite(n) || n <= 0) {
    throw new BadRequestException('Informe um valor válido maior que zero.');
  }
  return n;
}

export interface UploadNotaFiscalInput {
  oficinaId: string;
  parceiroId?: string;
  prefeituraId?: string;
  solicitacaoOsId?: string;
  value: unknown;
  file: Express.Multer.File;
}

export interface UploadNotaFiscalPostoInput {
  postoId: string;
  prefeituraId?: string;
  value: unknown;
  file: Express.Multer.File;
}

@Injectable()
export class NotasFiscaisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploadsService: UploadsService,
  ) {}

  private async validarEParsear(
    file: Express.Multer.File,
  ): Promise<ParsedDanfeData> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Envie o PDF no campo "file".');
    }
    if (file.size > MAX_PDF_BYTES) {
      throw new BadRequestException('O PDF deve ter no máximo 10 MB.');
    }
    const isPdf =
      file.mimetype === 'application/pdf' ||
      file.originalname.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      throw new BadRequestException(
        'Envie um arquivo PDF da DANFE NF-e (mod. 55) ou NFC-e (mod. 65).',
      );
    }
    return parseDanfePdf(file.buffer, file.originalname || 'nota-fiscal.pdf');
  }

  private dadosParseados(parsed: ParsedDanfeData) {
    return {
      description: parsed.description,
      category: parsed.category,
      documentType: parsed.documentType,
      number: parsed.number,
      issuerName: parsed.issuerName,
      issuedAt: parsed.issuedAt ? new Date(parsed.issuedAt) : null,
      accessKey: parsed.accessKey,
      value: parsed.value,
      status: 'pendente' as const,
      parseCompleteness: parsed.parseCompleteness,
    };
  }

  private async persistir(
    id: string,
    ownerId: string,
    payload: {
      companyId: string;
      prefeituraId: string;
      oficinaId?: string;
      postoId?: string;
      parceiroId?: string;
      solicitacaoOsId?: string;
      parsed: ParsedDanfeData;
      value: number;
      status?: NotaFiscalStatus;
    },
    file: Express.Multer.File,
  ): Promise<NotaFiscalApiItem> {
    const fileUrl = await this.uploadsService.uploadNotaFiscalPdf(ownerId, id, {
      buffer: file.buffer,
      mimetype: file.mimetype || 'application/pdf',
      originalname: file.originalname || 'nota-fiscal.pdf',
    });

    try {
      const row = await this.prisma.notaFiscal.create({
        data: {
          id,
          legacyId: id,
          companyId: payload.companyId,
          oficinaLegacyId: payload.oficinaId ?? null,
          postoLegacyId: payload.postoId ?? null,
          parceiroLegacyId: payload.parceiroId ?? null,
          solicitacaoOsId: payload.solicitacaoOsId ?? null,
          ...this.dadosParseados(payload.parsed),
          value: new Prisma.Decimal(payload.value),
          status: payload.status ?? 'pendente',
          fileName: file.originalname || 'nota-fiscal.pdf',
          fileUrl,
        },
      });
      return mapNotaFiscalRowToApi(row, payload.prefeituraId);
    } catch (error) {
      console.error('Erro ao salvar nota fiscal:', error);
      throw new InternalServerErrorException(
        'Não foi possível salvar a nota fiscal.',
      );
    }
  }

  async upload(input: UploadNotaFiscalInput): Promise<NotaFiscalApiItem> {
    const oficinaId = input.oficinaId.trim();
    if (!oficinaId) {
      throw new BadRequestException('oficinaId inválido.');
    }

    const parsed = await this.validarEParsear(input.file);
    const valorInformado = parseValorInformado(input.value);
    const prefeituraId = texto(input.prefeituraId);
    const companyId = prefeituraId
      ? await resolverCompanyId(this.prisma, prefeituraId)
      : null;
    if (!companyId || !prefeituraId) {
      throw new BadRequestException('prefeituraId inválido.');
    }

    if (parsed.accessKey) {
      const duplicate = await this.prisma.notaFiscal.findFirst({
        where: {
          oficinaLegacyId: oficinaId,
          accessKey: parsed.accessKey,
        },
      });
      if (duplicate) {
        throw new ConflictException(
          'Esta nota fiscal já foi enviada para esta oficina.',
        );
      }
    }

    const id = randomUUID();
    return this.persistir(
      id,
      oficinaId,
      {
        companyId,
        prefeituraId,
        oficinaId,
        parceiroId: texto(input.parceiroId) || undefined,
        solicitacaoOsId: texto(input.solicitacaoOsId) || undefined,
        parsed,
        value: valorInformado,
      },
      input.file,
    );
  }

  async uploadPorPosto(
    input: UploadNotaFiscalPostoInput,
  ): Promise<NotaFiscalApiItem> {
    const postoId = texto(input.postoId);
    if (!postoId) {
      throw new BadRequestException('postoId inválido.');
    }

    const parsed = await this.validarEParsear(input.file);

    if (parsed.accessKey) {
      const duplicate = await this.prisma.notaFiscal.findFirst({
        where: {
          postoLegacyId: postoId,
          accessKey: parsed.accessKey,
        },
      });
      if (duplicate) {
        throw new ConflictException('Esta nota fiscal já foi enviada.');
      }
    }

    const valorInformado = parseValorInformado(input.value);
    let companyId = texto(input.prefeituraId)
      ? await resolverCompanyId(this.prisma, texto(input.prefeituraId))
      : null;
    let prefeituraId = texto(input.prefeituraId);

    if (!companyId) {
      const partner = await this.prisma.partner.findFirst({
        where: { legacyId: postoId },
        include: { company: { select: { id: true, legacyId: true } } },
      });
      companyId = partner?.company.id ?? null;
      prefeituraId = partner?.company.legacyId ?? prefeituraId;
    }

    if (!companyId || !prefeituraId) {
      throw new BadRequestException(
        'Não foi possível identificar a prefeitura desta nota.',
      );
    }

    const id = randomUUID();
    return this.persistir(
      id,
      `posto-${postoId}`,
      {
        companyId,
        prefeituraId,
        postoId,
        parsed,
        value: valorInformado,
        status: 'aprovada',
      },
      input.file,
    );
  }

  async listarPorPosto(
    postoId: string,
  ): Promise<{ data: NotaFiscalApiItem[]; message: string }> {
    const id = postoId.trim();
    if (!id) {
      throw new BadRequestException('postoId inválido.');
    }
    try {
      const rows = await this.prisma.notaFiscal.findMany({
        where: { postoLegacyId: id },
        orderBy: { createdAt: 'desc' },
      });
      const data = rows.map((row) => mapNotaFiscalRowToApi(row));
      return { data, message: 'Notas fiscais carregadas com sucesso.' };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      console.error('Erro ao listar notas fiscais do posto:', error);
      throw new InternalServerErrorException(
        'Não foi possível carregar as notas fiscais.',
      );
    }
  }

  async listarCombustivelPorPrefeitura(
    prefeituraId: string,
  ): Promise<{ data: NotaFiscalApiItem[]; message: string }> {
    const id = prefeituraId.trim();
    if (!id) {
      throw new BadRequestException('prefeituraId inválido.');
    }
    try {
      const companyId = await resolverCompanyId(this.prisma, id);
      if (!companyId) {
        return { data: [], message: 'Notas fiscais carregadas com sucesso.' };
      }

      const rows = await this.prisma.notaFiscal.findMany({
        where: { companyId, postoLegacyId: { not: null } },
        orderBy: { createdAt: 'desc' },
      });
      const data = rows.map((row) => mapNotaFiscalRowToApi(row, id));
      return { data, message: 'Notas fiscais carregadas com sucesso.' };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      console.error('Erro ao listar notas fiscais de combustível:', error);
      throw new InternalServerErrorException(
        'Não foi possível carregar as notas fiscais.',
      );
    }
  }

  async listarOficinasPorPrefeitura(
    prefeituraId: string,
    query: ListNotasFiscaisPrefeituraQueryDto = {},
  ): Promise<{
    data: NotaFiscalPrefeituraListItem[];
    resumo: ReturnType<typeof calcularResumoNotasFiscais>;
    message: string;
  }> {
    const id = prefeituraId.trim();
    if (!id) {
      throw new BadRequestException('prefeituraId inválido.');
    }

    try {
      const companyId = await resolverCompanyId(this.prisma, id);
      if (!companyId) {
        return {
          data: [],
          resumo: calcularResumoNotasFiscais([]),
          message: 'Notas fiscais carregadas com sucesso.',
        };
      }

      const [rows, partners, orders] = await Promise.all([
        this.prisma.notaFiscal.findMany({
          where: { companyId, postoLegacyId: null },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.partner.findMany({
          where: { companyId, type: 'OFICINA' },
          select: {
            legacyId: true,
            razaoSocial: true,
            nomeFantasia: true,
          },
        }),
        this.prisma.serviceOrder.findMany({
          where: { companyId },
          select: {
            id: true,
            legacyId: true,
            protocolo: true,
            equipmentNome: true,
            oficinaVencedoraId: true,
            status: true,
            valorAprovado: true,
            createdAt: true,
            aprovadoEm: true,
          },
        }),
      ]);

      const base = rows
        .map((row) => mapNotaFiscalRowToApi(row, id))
        .filter((nf) => !nf.postoId);

      const ordens = orders.map((ordem) => ({
        id: ordem.legacyId ?? ordem.id,
        data: {
          protocolo: ordem.protocolo,
          equipamento: ordem.equipmentNome ?? '',
          oficinaId: ordem.oficinaVencedoraId ?? '',
          status: ordem.status,
          valorTotal: ordem.valorAprovado
            ? Number(ordem.valorAprovado)
            : 0,
          criadoEm: ordem.createdAt.toISOString(),
          aprovadoEm: ordem.aprovadoEm?.toISOString(),
        } as Record<string, unknown>,
      }));

      const osMaps = buildOsResolucaoMaps([], ordens);

      const oficinasMap = new Map<string, Record<string, unknown>>();
      for (const partner of partners) {
        if (!partner.legacyId) continue;
        oficinasMap.set(partner.legacyId, {
          razaoSocial: partner.razaoSocial,
          nomeFantasia: partner.nomeFantasia,
        });
      }

      const enriquecidas = base.map((item) =>
        enriquecerNotaFiscalPrefeitura(
          item,
          osMaps,
          oficinasMap.get(item.oficinaId),
        ),
      );

      const filtradas = filtrarNotasFiscaisPrefeitura(enriquecidas, query);

      return {
        data: filtradas,
        resumo: calcularResumoNotasFiscais(filtradas),
        message: 'Notas fiscais carregadas com sucesso.',
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      console.error('Erro ao listar notas fiscais das oficinas:', error);
      throw new InternalServerErrorException(
        'Não foi possível carregar as notas fiscais.',
      );
    }
  }

  async atualizarStatus(
    id: string,
    status: string,
  ): Promise<{ data: NotaFiscalApiItem; message: string }> {
    const notaId = texto(id);
    if (!notaId) {
      throw new BadRequestException('id inválido.');
    }
    if (!NOTA_FISCAL_STATUS.includes(status as NotaFiscalStatus)) {
      throw new BadRequestException(
        `status inválido. Use: ${NOTA_FISCAL_STATUS.join(', ')}.`,
      );
    }

    const row = await this.prisma.notaFiscal.findFirst({
      where: { OR: [{ id: notaId }, { legacyId: notaId }] },
      include: { company: { select: { legacyId: true } } },
    });
    if (!row) {
      throw new NotFoundException('Nota fiscal não encontrada.');
    }

    try {
      const updated = await this.prisma.notaFiscal.update({
        where: { id: row.id },
        data: { status },
      });
      return {
        data: mapNotaFiscalRowToApi(updated, row.company.legacyId ?? undefined),
        message: 'Status atualizado com sucesso.',
      };
    } catch (error) {
      console.error('Erro ao atualizar status da nota fiscal:', error);
      throw new InternalServerErrorException(
        'Não foi possível atualizar o status da nota fiscal.',
      );
    }
  }

  async listarPorOficina(
    oficinaId: string,
  ): Promise<{ data: NotaFiscalApiItem[]; message: string }> {
    const id = oficinaId.trim();
    if (!id) {
      throw new BadRequestException('oficinaId inválido.');
    }

    try {
      const rows = await this.prisma.notaFiscal.findMany({
        where: { oficinaLegacyId: id },
        orderBy: { createdAt: 'desc' },
      });
      const data = rows.map((row) => mapNotaFiscalRowToApi(row));
      return {
        data,
        message: 'Notas fiscais carregadas com sucesso.',
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      console.error('Erro ao listar notas fiscais:', error);
      throw new InternalServerErrorException(
        'Não foi possível carregar as notas fiscais.',
      );
    }
  }
}
