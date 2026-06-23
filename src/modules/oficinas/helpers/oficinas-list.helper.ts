import {
  especialidadeFromOficinaDoc,
  nomeFromOficinaDoc,
} from '../../os/helpers/especialidade-oficina.helper';
import type { OficinaListItem } from '../oficinas.types';

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

function listaTexto(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];
  return valor.filter((v): v is string => typeof v === 'string');
}

function isoOuNull(valor: unknown): string | null {
  const s = texto(valor);
  return s || null;
}

export function ehOficinaAtiva(status: unknown): boolean {
  return texto(status).toLowerCase().startsWith('ativ');
}

export function mapOficinaListItem(
  docId: string,
  data: Record<string, unknown>,
): OficinaListItem {
  const prefeituraId = isoOuNull(data.prefeituraId);
  const parceiroId = isoOuNull(data.parceiroId);
  const status = texto(data.status) || 'Ativa';

  return {
    id: docId,
    nome: nomeFromOficinaDoc(data, docId),
    razaoSocial: texto(data.razaoSocial),
    nomeFantasia: texto(data.nomeFantasia),
    cnpj: texto(data.cnpj),
    cidadeUf: texto(data.cidadeUf),
    endereco: texto(data.endereco),
    telefonePrincipal: texto(data.telefonePrincipal),
    emailComercial: texto(data.emailComercial),
    especialidade: especialidadeFromOficinaDoc(data),
    linhasAtuacao: listaTexto(data.linhasAtuacao),
    categoriasServico: listaTexto(data.categoriasServico),
    status,
    ativo: ehOficinaAtiva(status),
    prefeituraId,
    parceiroId: parceiroId ?? (prefeituraId ? docId : null),
    credenciadoEm: isoOuNull(data.credenciadoEm),
    createdAt: isoOuNull(data.createdAt),
  };
}
