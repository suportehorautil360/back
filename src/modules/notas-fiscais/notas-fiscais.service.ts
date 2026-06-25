import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { FieldValue } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import { FirebaseService } from '../../config/firebase.service';
import { UploadsService } from '../uploads/uploads.service';
import { mapNotaFiscalToApi } from './helpers/nota-fiscal-response.helper';
import { parseDanfePdf } from './helpers/parse-danfe-pdf.helper';
import type { NotaFiscalApiItem } from './notas-fiscais.types';

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

@Injectable()
export class NotasFiscaisService {
  constructor(
    private readonly firebaseService: FirebaseService,
    private readonly uploadsService: UploadsService,
  ) {}

  private get collection() {
    return this.firebaseService.getFirestore().collection('notasFiscais');
  }

  async upload(input: UploadNotaFiscalInput): Promise<NotaFiscalApiItem> {
    const oficinaId = input.oficinaId.trim();
    if (!oficinaId) {
      throw new BadRequestException('oficinaId inválido.');
    }

    const file = input.file;
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

    const parsed = await parseDanfePdf(
      file.buffer,
      file.originalname || 'nota-fiscal.pdf',
    );

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
    const fileUrl = await this.uploadsService.uploadNotaFiscalPdf(
      oficinaId,
      id,
      {
        buffer: file.buffer,
        mimetype: file.mimetype || 'application/pdf',
        originalname: file.originalname || 'nota-fiscal.pdf',
      },
    );

    const payload = {
      id,
      oficinaId,
      ...(texto(input.parceiroId) ? { parceiroId: texto(input.parceiroId) } : {}),
      ...(texto(input.prefeituraId)
        ? { prefeituraId: texto(input.prefeituraId) }
        : {}),
      ...(texto(input.solicitacaoOsId)
        ? { solicitacaoOsId: texto(input.solicitacaoOsId) }
        : {}),
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
      fileName: file.originalname || 'nota-fiscal.pdf',
      fileUrl,
      criadoEm: FieldValue.serverTimestamp(),
    };

    try {
      await this.collection.doc(id).set(payload);
      const saved = await this.collection.doc(id).get();
      return mapNotaFiscalToApi(
        id,
        (saved.data() ?? payload) as Record<string, unknown>,
      );
    } catch (error) {
      console.error('Erro ao salvar nota fiscal:', error);
      throw new InternalServerErrorException(
        'Não foi possível salvar a nota fiscal.',
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
