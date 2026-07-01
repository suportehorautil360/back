import type { OficinaAtiva } from '../os.types';
import {
  especialidadeFromOficinaDoc,
  nomeFromOficinaDoc,
} from './especialidade-oficina.helper';

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

function listaTexto(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];
  return valor.filter((v): v is string => typeof v === 'string' && v.trim() !== '');
}

export function ehOficinaAtiva(status: unknown): boolean {
  return texto(status).toLowerCase().startsWith('ativ');
}

/** Oficinas credenciadas no município (prefeituraId + status ativo). */
export function mapOficinaCredenciadaDoc(
  docId: string,
  data: Record<string, unknown>,
): OficinaAtiva | null {
  if (!ehOficinaAtiva(data.status ?? 'Ativa')) return null;
  if (!texto(data.prefeituraId)) return null;

  return {
    id: docId,
    nome: nomeFromOficinaDoc(data, docId),
    especialidade: especialidadeFromOficinaDoc(data),
    segmentosAtuacao: listaTexto(data.segmentosAtuacao),
  };
}