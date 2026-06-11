import {
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

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
  private cliente: SupabaseClient | null = null;

  private get bucket(): string {
    return process.env.SUPABASE_BUCKET_CHECKLISTS ?? 'checklists';
  }

  private getCliente(): SupabaseClient {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new ServiceUnavailableException(
        'Upload de fotos indisponível: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY não configuradas.',
      );
    }
    this.cliente ??= createClient(url, key);
    return this.cliente;
  }

  /** Sobe as fotos no bucket e devolve as URLs públicas, na mesma ordem. */
  async uploadChecklistFotos(
    checklistId: string,
    fotos: FotoUpload[],
  ): Promise<string[]> {
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
          'Não foi possível enviar as fotos do checklist.',
        );
      }
      urls.push(storage.getPublicUrl(path).data.publicUrl);
    }
    return urls;
  }
}
