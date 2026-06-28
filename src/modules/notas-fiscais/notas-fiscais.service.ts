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
import type { ListNotasFiscaisPrefeituraQueryDto } from './dto/list-notas-fiscais-prefeitura-query.dto';
import { mapNotaFiscalToApi } from './helpers/nota-fiscal-response.helper';
import {
  buildOsResolucaoMaps,
  chunkArray,
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

  private get oficinasCollection() {
    return this.firebaseService.getFirestore().collection('oficinas');
  }

  private get solicitacoesCollection() {
    return this.firebaseService.getFirestore().collection('solicitacoesOS');
  }

  private get ordensCollection() {
    return this.firebaseService.getFirestore().collection('ordensServico');
  }

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
        status: 'aprovada' as const,
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

  /** NF de combustível enviadas pelos postos. */
  async listarCombustivelPorPrefeitura(
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
        .filter((n) => !!n.postoId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { data, message: 'Notas fiscais carregadas com sucesso.' };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      console.error('Erro ao listar notas fiscais de combustível:', error);
      throw new InternalServerErrorException(
        'Não foi possível carregar as notas fiscais.',
      );
    }
  }

  /** NF enviadas pelas oficinas (O.S.), com cruzamento e resumo. */
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
      const [solSnap, ordensSnap, oficinasSnap, nfPorPref] = await Promise.all([
        this.solicitacoesCollection.where('prefeituraId', '==', id).get(),
        this.ordensCollection.where('prefeituraId', '==', id).get(),
        this.oficinasCollection.where('prefeituraId', '==', id).get(),
        this.collection.where('prefeituraId', '==', id).get(),
      ]);

      const oficinaIdsPref = oficinasSnap.docs.map((doc) => doc.id);
      const oficinaIdsOrdens = ordensSnap.docs
        .map((doc) => texto(doc.data().oficinaId))
        .filter(Boolean);
      const oficinaIdsCredenciadas = [
        ...new Set([...oficinaIdsPref, ...oficinaIdsOrdens]),
      ];

      const nfDocs = new Map<string, (typeof nfPorPref.docs)[number]>();
      for (const doc of nfPorPref.docs) {
        nfDocs.set(doc.id, doc);
      }

      for (const chunk of chunkArray(oficinaIdsCredenciadas, 30)) {
        if (chunk.length === 0) continue;
        const extraSnap = await this.collection
          .where('oficinaId', 'in', chunk)
          .get();
        for (const doc of extraSnap.docs) {
          if (!nfDocs.has(doc.id)) {
            nfDocs.set(doc.id, doc);
          }
        }
      }

      const oficinaIdsCredSet = new Set(oficinaIdsCredenciadas);
      const base = [...nfDocs.values()]
        .map((doc) =>
          mapNotaFiscalToApi(doc.id, doc.data() as Record<string, unknown>),
        )
        .filter((nf) => {
          if (nf.postoId) return false;
          if (texto(nf.prefeituraId) === id) return true;
          return oficinaIdsCredSet.has(nf.oficinaId);
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

      const osMaps = buildOsResolucaoMaps(
        solSnap.docs.map((doc) => ({
          id: doc.id,
          data: doc.data() as Record<string, unknown>,
        })),
        ordensSnap.docs.map((doc) => ({
          id: doc.id,
          data: doc.data() as Record<string, unknown>,
        })),
      );

      const oficinaIds = [
        ...new Set(base.map((n) => n.oficinaId).filter(Boolean)),
      ];
      const oficinasMap = await this.carregarOficinasMap(oficinaIds);

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

  private async carregarOficinasMap(
    ids: string[],
  ): Promise<Map<string, Record<string, unknown>>> {
    const map = new Map<string, Record<string, unknown>>();
    await Promise.all(
      ids.map(async (oficinaId) => {
        const snap = await this.oficinasCollection.doc(oficinaId).get();
        if (snap.exists) {
          map.set(oficinaId, snap.data() as Record<string, unknown>);
        }
      }),
    );
    return map;
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
