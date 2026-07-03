import type {
  ChecklistChegadaDoc,
  ChecklistChegadaItem,
  ChecklistChegadaPhotos,
} from '../checklist-chegada.types';
import type { CreateChecklistChegadaDto } from '../dto/create-checklist-chegada.dto';

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

function normalizeStatus(raw: unknown): ChecklistChegadaItem['status'] {
  const s = texto(raw).toLowerCase();
  if (s === 'ok') return 'ok';
  if (s === 'anomaly' || s === 'anomalia') return 'anomaly';
  if (s === 'na' || s === 'n/a') return 'na';
  return '';
}

export function mapChecklistItems(
  raw:
    | Record<string, { status?: string; photo?: string; description?: string }>
    | undefined,
): Record<string, ChecklistChegadaItem> {
  if (!raw || typeof raw !== 'object') return {};

  const out: Record<string, ChecklistChegadaItem> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!value || typeof value !== 'object') continue;
    const item: ChecklistChegadaItem = {
      status: normalizeStatus(value.status),
    };
    const photo = texto(value.photo);
    if (photo) item.photo = photo;
    const description = texto(value.description);
    if (description) item.description = description;
    out[key] = item;
  }
  return out;
}

export function mapPhotos(
  raw: CreateChecklistChegadaDto['photos'],
): ChecklistChegadaPhotos {
  return {
    frontal: texto(raw.frontal),
    lateralDireita: texto(raw.lateralDireita),
    traseira: texto(raw.traseira),
    lateralEsquerda: texto(raw.lateralEsquerda),
  };
}

export function buildChecklistChegadaDoc(
  id: string,
  number: string,
  dto: CreateChecklistChegadaDto,
  createdAt: string,
): ChecklistChegadaDoc {
  return {
    id,
    number,
    oficinaId: dto.oficinaId.trim(),
    parceiroId: texto(dto.parceiroId) || null,
    prefeituraId: texto(dto.prefeituraId) || null,
    solicitacaoOsId: texto(dto.solicitacaoOsId) || null,
    identification: {
      os: texto(dto.identification.os),
      entryDate: texto(dto.identification.entryDate),
      time: texto(dto.identification.time),
      responsible: texto(dto.identification.responsible),
      client: texto(dto.identification.client),
      brandModel: texto(dto.identification.brandModel),
      platePrefix: texto(dto.identification.platePrefix),
      km: texto(dto.identification.km),
      hourMeter: texto(dto.identification.hourMeter),
      fuel: texto(dto.identification.fuel),
    },
    photos: mapPhotos(dto.photos),
    inspection: mapChecklistItems(dto.inspection),
    blocks: mapChecklistItems(dto.blocks),
    term: {
      symptoms: texto(dto.term.symptoms),
      clientSignature: texto(dto.term.clientSignature),
      workshopSignature: texto(dto.term.workshopSignature),
    },
    createdAt,
  };
}

export function mapChecklistChegadaFromFirestore(
  docId: string,
  data: Record<string, unknown>,
): ChecklistChegadaDoc {
  const identification = (data.identification ?? {}) as Record<string, unknown>;
  const photos = (data.photos ?? {}) as Record<string, unknown>;
  const term = (data.term ?? {}) as Record<string, unknown>;

  return {
    id: docId,
    number: texto(data.number),
    oficinaId: texto(data.oficinaId),
    parceiroId: texto(data.parceiroId) || null,
    prefeituraId: texto(data.prefeituraId) || null,
    solicitacaoOsId: texto(data.solicitacaoOsId) || null,
    identification: {
      os: texto(identification.os),
      entryDate: texto(identification.entryDate),
      time: texto(identification.time),
      responsible: texto(identification.responsible),
      client: texto(identification.client),
      brandModel: texto(identification.brandModel),
      platePrefix: texto(identification.platePrefix),
      km: texto(identification.km),
      hourMeter: texto(identification.hourMeter),
      fuel: texto(identification.fuel),
    },
    photos: {
      frontal: texto(photos.frontal),
      lateralDireita: texto(photos.lateralDireita),
      traseira: texto(photos.traseira),
      lateralEsquerda: texto(photos.lateralEsquerda),
    },
    inspection: mapChecklistItems(
      data.inspection as Record<
        string,
        { status?: string; photo?: string; description?: string }
      >,
    ),
    blocks: mapChecklistItems(
      data.blocks as Record<
        string,
        { status?: string; photo?: string; description?: string }
      >,
    ),
    term: {
      symptoms: texto(term.symptoms),
      clientSignature: texto(term.clientSignature),
      workshopSignature: texto(term.workshopSignature),
    },
    createdAt: texto(data.createdAt),
  };
}
