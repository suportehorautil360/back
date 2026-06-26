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
    ...(texto(raw.oficinaId) ? { oficinaId: texto(raw.oficinaId) } : {}),
    ...(texto(raw.postoId) ? { postoId: texto(raw.postoId) } : {}),
    ...(texto(raw.prefeituraId) ? { prefeituraId: texto(raw.prefeituraId) } : {}),
    channel: texto(raw.channel) as SuporteChannel,
    sender: texto(raw.sender) as SuporteSender,
    text: texto(raw.text),
    createdAt,
    ...(Object.prototype.hasOwnProperty.call(raw, 'readAt') ||
    Object.prototype.hasOwnProperty.call(raw, 'lidoEm')
      ? { readAt }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(raw, 'adminReadAt')
      ? {
          adminReadAt:
            raw.adminReadAt === null
              ? null
              : timestampToIso(raw.adminReadAt) || texto(raw.adminReadAt) || null,
        }
      : {}),
    ...(raw.autoReply === true ? { autoReply: true } : {}),
  };
}
