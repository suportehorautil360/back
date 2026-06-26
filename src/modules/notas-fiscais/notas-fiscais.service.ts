import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { FieldValue } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import { FirebaseService } from '../../config/firebase.service';
import { UploadsService } from '../uploads/uploads.service';
import { mapNotaFiscalToApi } from './helpers/nota-fiscal-response.helper';
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

export interface UploadNotaFiscalInput {
  oficinaId: string;
  parceiroId?: string;
  prefeituraId?: string;
  solicitacaoOsId?: string;
  file: Express.Multer.File;
}

export interface UploadNotaFiscalPostoInput {
  postoId: string;
  prefeituraId?: string;
  file: Express.Multer.File;
}

@Injectable()
export class NotasFiscaisService {
  constructor(
    private readonly firebaseService: FirebaseService,
    private readonly uploadsService: UploadsService,
  ) {}

  private get collection() {
    return this.firebaseService.getFirestore().collection('notasFiscais');
  }

  /** Valida o arquivo recebido e devolve os dados extraídos do PDF da DANFE. */
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

  /** Grava o doc e devolve já mapeado para a API. */
  private async persistir(
    id: string,
    ownerId: string,
    payload: Record<string, unknown>,
    file: Express.Multer.File,
  ): Promise<NotaFiscalApiItem> {
    const fileUrl = await this.uploadsService.uploadNotaFiscalPdf(ownerId, id, {
      buffer: file.buffer,
      mimetype: file.mimetype || 'application/pdf',
      originalname: file.originalname || 'nota-fiscal.pdf',
    });

    const doc = {
      ...payload,
      id,
      fileName: file.originalname || 'nota-fiscal.pdf',
      fileUrl,
      criadoEm: FieldValue.serverTimestamp(),
    };

    try {
      await this.collection.doc(id).set(doc);
      const saved = await this.collection.doc(id).get();
      return mapNotaFiscalToApi(
        id,
        (saved.data() ?? doc) as Record<string, unknown>,
      );
    } catch (error) {
      console.error('Erro ao salvar nota fiscal:', error);
      throw new InternalServerErrorException(
        'Não foi possível salvar a nota fiscal.',
      );
    }
  }

  private dadosParseados(parsed: ParsedDanfeData) {
    return {
      description: parsed.description,
      category: parsed.category,
      documentType: parsed.documentType,
      number: parsed.number,
      issuerName: parsed.issuerName,
      issuedAt: parsed.issuedAt,
      accessKey: parsed.accessKey,
      value: parsed.value,
      status: 'pendente' as const,
      parseCompleteness: parsed.parseCompleteness,
    };
  }

  async upload(input: UploadNotaFiscalInput): Promise<NotaFiscalApiItem> {
    const oficinaId = input.oficinaId.trim();
    if (!oficinaId) {
      throw new BadRequestException('oficinaId inválido.');
    }

    const parsed = await this.validarEParsear(input.file);

    if (parsed.accessKey) {
      const duplicate = await this.collection
        .where('oficinaId', '==', oficinaId)
        .where('accessKey', '==', parsed.accessKey)
        .limit(1)
        .get();

      if (!duplicate.empty) {
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
        oficinaId,
        ...(texto(input.parceiroId)
          ? { parceiroId: texto(input.parceiroId) }
          : {}),
        ...(texto(input.prefeituraId)
          ? { prefeituraId: texto(input.prefeituraId) }
          : {}),
        ...(texto(input.solicitacaoOsId)
          ? { solicitacaoOsId: texto(input.solicitacaoOsId) }
          : {}),
        ...this.dadosParseados(parsed),
      },
      input.file,
    );
  }

  /** Upload de NF de combustível enviada por um posto (posto-web). */
  async uploadPorPosto(
    input: UploadNotaFiscalPostoInput,
  ): Promise<NotaFiscalApiItem> {
    const postoId = texto(input.postoId);
    if (!postoId) {
      throw new BadRequestException('postoId inválido.');
    }

    const parsed = await this.validarEParsear(input.file);

    if (parsed.accessKey) {
      const duplicate = await this.collection
        .where('postoId', '==', postoId)
        .where('accessKey', '==', parsed.accessKey)
        .limit(1)
        .get();

      if (!duplicate.empty) {
        throw new ConflictException('Esta nota fiscal já foi enviada.');
      }
    }

    const id = randomUUID();
    return this.persistir(
      id,
      `posto-${postoId}`,
      {
        postoId,
        ...(texto(input.prefeituraId)
          ? { prefeituraId: texto(input.prefeituraId) }
          : {}),
        ...this.dadosParseados(parsed),
      },
      input.file,
    );
  }

  /** Notas de combustível enviadas por um posto específico (posto-web). */
  async listarPorPosto(
    postoId: string,
  ): Promise<{ data: NotaFiscalApiItem[]; message: string }> {
    const id = postoId.trim();
    if (!id) {
      throw new BadRequestException('postoId inválido.');
    }
    try {
      const snap = await this.collection.where('postoId', '==', id).get();
      const data = snap.docs
        .map((doc) =>
          mapNotaFiscalToApi(doc.id, doc.data() as Record<string, unknown>),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { data, message: 'Notas fiscais carregadas com sucesso.' };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      console.error('Erro ao listar notas fiscais do posto:', error);
      throw new InternalServerErrorException(
        'Não foi possível carregar as notas fiscais.',
      );
    }
  }

  /** Notas de combustível dos postos de uma prefeitura (web-360, aprovação). */
  async listarPorPrefeitura(
    prefeituraId: string,
  ): Promise<{ data: NotaFiscalApiItem[]; message: string }> {
    const id = prefeituraId.trim();
    if (!id) {
      throw new BadRequestException('prefeituraId inválido.');
    }
    try {
      const snap = await this.collection
        .where('prefeituraId', '==', id)
        .get();
      const data = snap.docs
        .map((doc) =>
          mapNotaFiscalToApi(doc.id, doc.data() as Record<string, unknown>),
        )
        // Só notas de posto (combustível); oficina tem fluxo próprio por O.S.
        .filter((n) => !!n.postoId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { data, message: 'Notas fiscais carregadas com sucesso.' };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      console.error('Erro ao listar notas fiscais da prefeitura:', error);
      throw new InternalServerErrorException(
        'Não foi possível carregar as notas fiscais.',
      );
    }
  }

  /** Aprova/rejeita uma nota (web-360). */
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
    const ref = this.collection.doc(notaId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new NotFoundException('Nota fiscal não encontrada.');
    }
    try {
      await ref.update({
        status,
        statusAtualizadoEm: FieldValue.serverTimestamp(),
      });
      const saved = await ref.get();
      return {
        data: mapNotaFiscalToApi(
          notaId,
          (saved.data() ?? {}) as Record<string, unknown>,
        ),
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
      const snap = await this.collection.where('oficinaId', '==', id).get();

      const data = snap.docs
        .map((doc) =>
          mapNotaFiscalToApi(doc.id, doc.data() as Record<string, unknown>),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

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
