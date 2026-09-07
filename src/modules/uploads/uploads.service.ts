import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { PrismaService } from '../../prisma/prisma.service';
import { resolverCompanyId } from '../../common/prisma/company-resolver';

export type FotoUpload = {
  /** Identificador da foto dentro do checklist (ex.: "horimetro", "item-3"). */
  nome: string;
  buffer: Buffer;
  mimetype: string;
};

const EXTENSOES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const DEFAULT_NOTA_FISCAL_BUCKET = 'notas-fiscais';

/** Privado por exigência da Portaria 671 — ver o comentário de `photoUrl` no schema. */
const BUCKET_SELFIES_PONTO = 'ponto-selfies';

/**
 * Teto real do bucket `ponto-selfies` (`file_size_limit` na migration do
 * horautil, `20260821090000_storage_buckets_rh`). Exportado para o
 * controller usar no `FileInterceptor` — um arquivo que passa no Nest e é
 * recusado pelo Storage vira 500 e pendência presa na fila do app.
 */
export const LIMITE_BYTES_SELFIE_PONTO = 2 * 1024 * 1024;

function storageErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

/** Só letras/números/hífen — evita path traversal e chaves inválidas no bucket. */
function sanitizar(parte: string): string {
  return parte.replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-');
}

/**
 * Upload de fotos de checklist para o Supabase Storage. As fotos saíam em
 * base64 dentro do documento do Firestore, estourando o limite de 1 MiB —
 * aqui viram arquivos no bucket e o doc guarda apenas as URLs.
 */
@Injectable()
export class UploadsService {
  constructor(private readonly prisma: PrismaService) {}

  private cliente: SupabaseClient | null = null;
  private readonly ensuredBuckets = new Set<string>();

  private get bucket(): string {
    return process.env.SUPABASE_BUCKET_CHECKLISTS ?? 'checklists';
  }

  private get bucketNotasFiscaisConfigurado(): string | undefined {
    return process.env.SUPABASE_BUCKET_NOTAS_FISCAIS?.trim() || undefined;
  }

  private get dedicatedNotaFiscalBucket(): string {
    return this.bucketNotasFiscaisConfigurado ?? DEFAULT_NOTA_FISCAL_BUCKET;
  }

  private buildNotaFiscalUploadAttempts(relativePath: string): Array<{
    bucket: string;
    path: string;
    ensureBucket: boolean;
  }> {
    return [
      {
        bucket: this.dedicatedNotaFiscalBucket,
        path: relativePath,
        ensureBucket: true,
      },
      {
        bucket: this.bucket,
        path: `notas-fiscais/${relativePath}`,
        ensureBucket: false,
      },
    ];
  }

  private isBucketNotFoundError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const rec = error as { message?: string; statusCode?: string };
    const message = (rec.message ?? '').toLowerCase();
    return (
      rec.statusCode === '404' ||
      message.includes('bucket not found') ||
      message.includes('bucket não encontrado')
    );
  }

  private async ensureBucket(
    bucketName: string,
    publico = true,
  ): Promise<void> {
    if (this.ensuredBuckets.has(bucketName)) return;

    const client = this.getCliente();
    const { data: buckets, error: listError } =
      await client.storage.listBuckets();

    if (!listError && buckets?.some((bucket) => bucket.name === bucketName)) {
      this.ensuredBuckets.add(bucketName);
      return;
    }

    const { error: createError } = await client.storage.createBucket(
      bucketName,
      {
        public: publico,
        fileSizeLimit: 10 * 1024 * 1024,
      },
    );

    if (
      !createError ||
      createError.message.toLowerCase().includes('already exists')
    ) {
      this.ensuredBuckets.add(bucketName);
      return;
    }

    throw createError;
  }

  private async uploadPdfToBucket(
    bucketName: string,
    path: string,
    file: { buffer: Buffer; mimetype: string },
  ): Promise<
    | { ok: true; url: string }
    | { ok: false; bucketNotFound: boolean; error: unknown }
  > {
    const storage = this.getCliente().storage.from(bucketName);
    const { error } = await storage.upload(path, file.buffer, {
      contentType: file.mimetype || 'application/pdf',
      upsert: true,
    });

    if (error) {
      console.error(
        `Supabase upload falhou [bucket=${bucketName} path=${path}]:`,
        error,
      );
      return {
        ok: false,
        bucketNotFound: this.isBucketNotFoundError(error),
        error,
      };
    }

    return {
      ok: true,
      url: storage.getPublicUrl(path).data.publicUrl,
    };
  }

  private getCliente(): SupabaseClient {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new ServiceUnavailableException(
        'Upload de fotos indisponível: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY não configuradas.',
      );
    }
    this.cliente ??= createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      realtime: {
        // Tipos de @types/ws divergem do WebSocketLike do Supabase; funciona em runtime.
        transport: WebSocket as unknown as typeof globalThis.WebSocket,
      },
    });
    return this.cliente;
  }

  /** Sobe as fotos no bucket e devolve as URLs públicas, na mesma ordem. */
  async uploadChecklistFotos(
    checklistId: string,
    fotos: FotoUpload[],
  ): Promise<string[]> {
    await this.ensureBucket(this.bucket);
    const storage = this.getCliente().storage.from(this.bucket);
    const urls: string[] = [];
    for (const foto of fotos) {
      const ext = EXTENSOES[foto.mimetype] ?? 'jpg';
      const path = `${sanitizar(checklistId)}/${sanitizar(foto.nome)}.${ext}`;
      const { error } = await storage.upload(path, foto.buffer, {
        contentType: foto.mimetype,
        upsert: true,
      });
      if (error) {
        console.error('Erro no upload para o Supabase Storage:', error);
        throw new InternalServerErrorException(
          `Não foi possível enviar as fotos do checklist: ${storageErrorMessage(error)}`,
        );
      }
      urls.push(storage.getPublicUrl(path).data.publicUrl);
    }
    return urls;
  }

  /**
   * Sobe o PDF da nota fiscal e devolve a URL pública. `ownerId` é o 1º segmento
   * do path (ex.: id da oficina ou `posto-<postoId>`), apenas para organização.
   */
  async uploadNotaFiscalPdf(
    ownerId: string,
    notaId: string,
    file: { buffer: Buffer; mimetype: string; originalname: string },
  ): Promise<string> {
    const ext = file.originalname.toLowerCase().endsWith('.pdf') ? 'pdf' : 'pdf';
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '-');
    const relativePath = `${sanitizar(ownerId)}/${sanitizar(notaId)}/${Date.now()}-${safeName || `nota.${ext}`}`;
    const attempts = this.buildNotaFiscalUploadAttempts(relativePath);

    let lastError: unknown = null;

    for (const attempt of attempts) {
      if (attempt.ensureBucket) {
        try {
          await this.ensureBucket(attempt.bucket);
        } catch (error) {
          console.error(
            `Não foi possível garantir bucket ${attempt.bucket}:`,
            error,
          );
          lastError = error;
          continue;
        }
      }

      const result = await this.uploadPdfToBucket(
        attempt.bucket,
        attempt.path,
        file,
      );

      if (result.ok) {
        return result.url;
      }

      lastError = result.error;
    }

    const detail = storageErrorMessage(lastError);
    console.error('Erro no upload da nota fiscal:', lastError);
    throw new InternalServerErrorException(
      detail
        ? `Não foi possível enviar o PDF da nota fiscal: ${detail}`
        : 'Não foi possível enviar o PDF da nota fiscal.',
    );
  }

  /**
   * Sobe a selfie da batida e devolve a CHAVE no bucket privado.
   *
   * Não reaproveita `uploadChecklistFotos`: aquele grava em bucket
   * `public: true` e devolve `getPublicUrl` — URL que qualquer um abre. Para a
   * foto do horímetro passa; para o rosto de uma pessoa amarrado ao CPF, não.
   *
   * A chave segue o MESMO formato que o horautil usa para este bucket
   * (`lib/storage/chaves.ts#montarChave`): `{companyId}/{ano}/{mes}/{id}.ext`,
   * ano/mês em UTC. O primeiro segmento tem de ser o `companyId` porque é
   * exatamente o que a policy de RLS do bucket confere
   * (`(storage.foldername(name))[1] = auth_company_id()`) — qualquer outro
   * valor ali e a foto fica gravada mas ilegível para o painel e o app do
   * trabalhador. Por isso `companyId` é resolvido aqui, no servidor, a partir
   * do `prefeituraId` recebido — nunca aceito pronto do corpo da requisição.
   *
   * O upload é `upsert`: reenviar sobrescreve o mesmo objeto em vez de
   * acumular cópias, que é o que torna este upload idempotente sem chave de
   * idempotência nenhuma.
   */
  async uploadSelfiePonto(
    prefeituraId: string,
    pontoId: string,
    file: { buffer: Buffer; mimetype: string },
  ): Promise<string> {
    if (!pontoId?.trim()) {
      throw new BadRequestException('pontoId é obrigatório.');
    }

    const companyId = await resolverCompanyId(this.prisma, prefeituraId);
    if (!companyId) {
      throw new NotFoundException('Empresa não encontrada.');
    }

    await this.ensureBucket(BUCKET_SELFIES_PONTO, false);
    const ext = EXTENSOES[file.mimetype] ?? 'jpg';
    const agora = new Date();
    const ano = agora.getUTCFullYear();
    const mes = String(agora.getUTCMonth() + 1).padStart(2, '0');
    const path = `${sanitizar(companyId)}/${ano}/${mes}/${sanitizar(pontoId)}.${ext}`;
    const storage = this.getCliente().storage.from(BUCKET_SELFIES_PONTO);
    const { error } = await storage.upload(path, file.buffer, {
      contentType: file.mimetype,
      upsert: true,
    });
    if (error) {
      console.error('Erro no upload da selfie de ponto:', error);
      throw new InternalServerErrorException(
        `Não foi possível enviar a selfie: ${storageErrorMessage(error)}`,
      );
    }
    return path;
  }
}
