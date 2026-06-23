import type { CollectionReference } from 'firebase-admin/firestore';
import type { CreateChecklistDevolucaoDto } from '../dto/create-checklist-devolucao.dto';

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

function identificationRaw(
  dto: CreateChecklistDevolucaoDto,
): Record<string, unknown> {
  const loose = dto as unknown as Record<string, unknown>;
  const nested = dto.identification ?? loose.identificacao;
  if (nested && typeof nested === 'object') {
    return nested as unknown as Record<string, unknown>;
  }
  return {};
}

/** Protocolo da O.S. — body, identification ou Firestore via solicitacaoOsId. */
export async function resolveOsProtocolo(
  dto: CreateChecklistDevolucaoDto,
  solicitacoes: CollectionReference,
): Promise<string> {
  const loose = dto as unknown as Record<string, unknown>;
  const idBlock = identificationRaw(dto);

  const direto =
    texto(idBlock.os) ||
    texto(idBlock.protocolo) ||
    texto(idBlock.protocol) ||
    texto(idBlock.osRef) ||
    texto(loose.os) ||
    texto(loose.protocolo) ||
    texto(loose.protocol);

  if (direto) return direto;

  const solId = texto(dto.solicitacaoOsId) || texto(loose.solicitacaoOsId);
  if (!solId) return '';

  const snap = await solicitacoes.doc(solId).get();
  if (!snap.exists) return '';

  const sol = snap.data() as Record<string, unknown>;
  return texto(sol.protocolo) || texto(sol.protocol);
}

export function mergeIdentificationOs(
  dto: CreateChecklistDevolucaoDto,
  os: string,
): CreateChecklistDevolucaoDto {
  const idBlock = identificationRaw(dto);
  return {
    ...dto,
    identification: {
      ...(dto.identification ?? ({} as CreateChecklistDevolucaoDto['identification'])),
      os,
      date: texto(idBlock.date) || dto.identification?.date || '',
      time: texto(idBlock.time) || dto.identification?.time || '',
      brandModel:
        texto(idBlock.brandModel) || dto.identification?.brandModel || '',
      platePrefix:
        texto(idBlock.platePrefix) || dto.identification?.platePrefix || '',
      currentKm:
        texto(idBlock.currentKm) ||
        texto(idBlock.km) ||
        dto.identification?.currentKm ||
        '',
      hourMeter:
        texto(idBlock.hourMeter) || dto.identification?.hourMeter || '',
      driver: texto(idBlock.driver) || dto.identification?.driver || '',
      technicalResponsible:
        texto(idBlock.technicalResponsible) ||
        dto.identification?.technicalResponsible ||
        '',
      fuel: texto(idBlock.fuel) || dto.identification?.fuel || '1/2',
    },
  };
}
