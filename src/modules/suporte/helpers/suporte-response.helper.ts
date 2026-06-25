import { timestampToIso } from '../../os/helpers/timestamp.helper';
import type {
  SuporteChannel,
  SuporteMensagemApi,
  SuporteSender,
} from '../suporte.types';

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

export function mapMensagemToApi(
  id: string,
  raw: Record<string, unknown>,
): SuporteMensagemApi {
  const createdAt =
    timestampToIso(raw.createdAt ?? raw.criadoEm) || new Date().toISOString();
  const readAtRaw = raw.readAt ?? raw.lidoEm;
  const readAt =
    readAtRaw === null
      ? null
      : texto(readAtRaw) || timestampToIso(readAtRaw) || null;

  return {
    id: texto(raw.id) || id,
    oficinaId: texto(raw.oficinaId),
    channel: texto(raw.channel) as SuporteChannel,
    sender: texto(raw.sender) as SuporteSender,
    text: texto(raw.text),
    createdAt,
    ...(readAt !== undefined ? { readAt } : {}),
  };
}
