export interface CredChecklist {
  fisc_cndt: boolean;
  fisc_estadual: boolean;
  fisc_federal: boolean;
  fisc_fgts: boolean;
  fisc_municipal: boolean;
  hab_balanco: boolean;
  hab_falencia: boolean;
  id_cnpj: boolean;
  id_contrato: boolean;
  id_endereco: boolean;
  id_socios: boolean;
  tec_alvara: boolean;
  tec_ambiental: boolean;
  tec_atestado: boolean;
  tec_avcb: boolean;
}

export type CredLevel = 'FULL' | 'PARTIAL' | 'PENDING';

const CHECKLIST_KEYS: (keyof CredChecklist)[] = [
  'fisc_cndt',
  'fisc_estadual',
  'fisc_federal',
  'fisc_fgts',
  'fisc_municipal',
  'hab_balanco',
  'hab_falencia',
  'id_cnpj',
  'id_contrato',
  'id_endereco',
  'id_socios',
  'tec_alvara',
  'tec_ambiental',
  'tec_atestado',
  'tec_avcb',
];

export function computeCredLevel(checklist: CredChecklist): CredLevel {
  const done = CHECKLIST_KEYS.filter((k) => checklist[k] === true).length;
  if (done === CHECKLIST_KEYS.length) return 'FULL';
  if (done === 0) return 'PENDING';
  return 'PARTIAL';
}
