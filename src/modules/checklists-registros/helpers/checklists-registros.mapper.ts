import type {
  ChecklistRegistroDoc,
  ChecklistRegistroItemNao,
} from '../checklists-registros.types';

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

function numero(valor: unknown): number {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  if (typeof valor === 'string') {
    const n = Number(valor);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function mapItensNao(raw: unknown): ChecklistRegistroItemNao[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const rec = item as Record<string, unknown>;
      return {
        titulo: texto(rec.titulo) || undefined,
        problema: texto(rec.problema) || undefined,
        numero: texto(rec.numero) || undefined,
        impeditivo: rec.impeditivo === true ? true : undefined,
      };
    });
}

function mapRespostas(raw: unknown): Record<string, unknown> | string {
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

export function mapChecklistRegistroFromFirestore(
  docId: string,
  data: Record<string, unknown>,
): ChecklistRegistroDoc {
  return {
    id: texto(data.id) || docId,
    dataHoraIso: texto(data.dataHoraIso),
    operador: texto(data.operador),
    chassis: texto(data.chassis),
    categoria: texto(data.categoria),
    modelo: texto(data.modelo),
    linha: texto(data.linha),
    totalItens: numero(data.totalItens),
    totalSim: numero(data.totalSim),
    totalNao: numero(data.totalNao),
    totalNa: numero(data.totalNa),
    totalAplicaveis: numero(data.totalAplicaveis),
    pontuacao: numero(data.pontuacao),
    horimetro: texto(data.horimetro),
    assinaturaOperador: texto(data.assinaturaOperador),
    respostas: mapRespostas(data.respostas),
    obs: texto(data.obs) || null,
    localizacaoGps: data.localizacaoGps ?? null,
    prefeituraId: texto(data.prefeituraId),
    idOperadorSession: texto(data.idOperadorSession),
    itensNao: mapItensNao(data.itensNao),
  };
}

type ChecklistRunRow = {
  id: string;
  legacyId: string | null;
  operadorLegacyId: string | null;
  operadorNome: string | null;
  chassi: string | null;
  categoria: string | null;
  modelo: string | null;
  linha: string | null;
  totalItens: number | null;
  totalSim: number | null;
  totalNao: number | null;
  totalNa: number | null;
  totalAplicaveis: number | null;
  pontuacao: number | null;
  horimetro: string | null;
  assinaturaOperador: string | null;
  respostas: unknown;
  obs: string | null;
  localizacaoGps: string | null;
  itensNao: unknown;
  executedAt: Date | null;
  createdAt: Date;
};

export function mapChecklistRunRowToDoc(
  row: ChecklistRunRow,
  prefeituraId: string,
): ChecklistRegistroDoc {
  const dataHoraIso =
    row.executedAt?.toISOString() ?? row.createdAt.toISOString();

  return {
    id: row.legacyId ?? row.id,
    dataHoraIso,
    operador: texto(row.operadorNome),
    chassis: texto(row.chassi),
    categoria: texto(row.categoria),
    modelo: texto(row.modelo),
    linha: texto(row.linha),
    totalItens: numero(row.totalItens),
    totalSim: numero(row.totalSim),
    totalNao: numero(row.totalNao),
    totalNa: numero(row.totalNa),
    totalAplicaveis: numero(row.totalAplicaveis),
    pontuacao: numero(row.pontuacao),
    horimetro: texto(row.horimetro),
    assinaturaOperador: texto(row.assinaturaOperador),
    respostas: mapRespostas(row.respostas),
    obs: texto(row.obs) || null,
    localizacaoGps: row.localizacaoGps ?? null,
    prefeituraId,
    idOperadorSession: texto(row.operadorLegacyId),
    itensNao: mapItensNao(row.itensNao),
  };
}
