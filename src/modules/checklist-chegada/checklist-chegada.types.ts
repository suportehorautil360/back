export type ChecklistItemStatus = 'ok' | 'anomaly' | 'na' | '';

export interface ChecklistChegadaItem {
  status: ChecklistItemStatus;
  photo?: string;
  description?: string;
}

export interface ChecklistChegadaIdentification {
  os: string;
  entryDate: string;
  time: string;
  responsible: string;
  client: string;
  brandModel: string;
  platePrefix: string;
  km: string;
  hourMeter: string;
  fuel: string;
}

export interface ChecklistChegadaPhotos {
  frontal: string;
  lateralDireita: string;
  traseira: string;
  lateralEsquerda: string;
}

export interface ChecklistChegadaTerm {
  symptoms: string;
  clientSignature: string;
  workshopSignature: string;
}

export interface ChecklistChegadaDoc {
  id: string;
  number: string;
  oficinaId: string;
  parceiroId: string | null;
  prefeituraId: string | null;
  solicitacaoOsId: string | null;
  identification: ChecklistChegadaIdentification;
  photos: ChecklistChegadaPhotos;
  inspection: Record<string, ChecklistChegadaItem>;
  blocks: Record<string, ChecklistChegadaItem>;
  term: ChecklistChegadaTerm;
  createdAt: string;
}
