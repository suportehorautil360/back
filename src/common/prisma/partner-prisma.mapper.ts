import type { Partner, PartnerType } from '../../prisma/generated/client';
import type {
  OficinaParceiro,
  ParceiroDetalhe,
  PostoParceiro,
  TipoParceiro,
} from '../../modules/parceiros/parceiros.types';
import {
  especialidadeFromOficinaDoc,
  nomeFromOficinaDoc,
} from '../../modules/os/helpers/especialidade-oficina.helper';
import {
  linhasAtuacaoFromSegmentos,
  segmentosEfetivosCadastro,
} from '../../modules/os/helpers/segmento-equipamento.helper';
import { publicLegacyId } from './service-order-resolver';
import type { OficinaCredenciadaListItem } from '../../modules/clientes/clientes-oficinas.types';
import type { OficinaListItem } from '../../modules/oficinas/oficinas.types';

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

function listaTexto(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];
  return valor.filter((v): v is string => typeof v === 'string' && v.trim() !== '');
}

function numero(valor: unknown): number {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;
  if (typeof valor === 'string') {
    const n = Number(valor.replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function partnerTypeToApi(type: PartnerType): TipoParceiro {
  return type === 'OFICINA' ? 'oficina' : 'posto';
}

export function apiTypeToPartnerType(tipo: TipoParceiro): PartnerType {
  return tipo === 'oficina' ? 'OFICINA' : 'POSTO';
}

export function partnerToFirestoreShape(row: Partner): Record<string, unknown> {
  return {
    id: publicLegacyId(row),
    prefeituraId: '',
    razaoSocial: row.razaoSocial,
    nomeFantasia: row.nomeFantasia,
    nome: row.nomeFantasia ?? row.razaoSocial,
    cnpj: row.cnpj,
    telefonePrincipal: row.telefonePrincipal,
    emailComercial: row.emailComercial,
    cidadeUf: row.cidadeUf,
    endereco: row.endereco,
    bandeira: row.bandeira,
    combustiveis: listaTexto(row.combustiveis),
    servicos: listaTexto(row.servicos),
    linhasAtuacao: listaTexto(row.linhasAtuacao),
    segmentosAtuacao: listaTexto(row.segmentosAtuacao),
    categoriasServico: listaTexto(row.categoriasServico),
    especialidade: row.especialidade,
    condicaoPagamento: row.condicaoPagamento,
    limiteCredito: row.limiteCredito,
    descontoComercial: row.descontoComercial,
    observacoesFaturamento: row.observacoesFaturamento,
    status: row.ativo ? 'Ativa' : row.status,
  };
}

export function mapPartnerToPostoOverview(
  row: Partner,
  prefeituraLegacyId: string,
  localFallback: string,
): PostoParceiro {
  return {
    id: publicLegacyId(row),
    prefeituraId: prefeituraLegacyId,
    nome: row.nomeFantasia?.trim() || row.razaoSocial,
    razaoSocial: row.razaoSocial,
    cidadeUf: row.cidadeUf?.trim() || localFallback,
    bandeira: row.bandeira ?? '',
    condicaoPagamento: row.condicaoPagamento ?? '',
    limiteCredito: numero(row.limiteCredito),
    ativo: row.ativo,
  };
}

export function mapPartnerToOficinaOverview(
  row: Partner,
  prefeituraLegacyId: string,
  localFallback: string,
): OficinaParceiro {
  const shape = partnerToFirestoreShape(row);
  const categorias = listaTexto(row.categoriasServico);
  return {
    id: publicLegacyId(row),
    prefeituraId: prefeituraLegacyId,
    nome: nomeFromOficinaDoc(shape, publicLegacyId(row)),
    razaoSocial: row.razaoSocial,
    cidadeUf: row.cidadeUf?.trim() || localFallback,
    especialidade: row.especialidade?.trim() || categorias.join(', '),
    condicaoPagamento: row.condicaoPagamento ?? '',
    limiteCredito: numero(row.limiteCredito),
    ativo: row.ativo,
  };
}

export function mapPartnerToDetalhe(
  row: Partner,
  prefeituraLegacyId: string,
): ParceiroDetalhe {
  const tipo = partnerTypeToApi(row.type);
  const shape = partnerToFirestoreShape(row);
  const segmentosAtuacao = segmentosEfetivosCadastro(
    listaTexto(row.segmentosAtuacao),
    listaTexto(row.linhasAtuacao),
  );
  const linhasAtuacao = linhasAtuacaoFromSegmentos(segmentosAtuacao);

  return {
    id: publicLegacyId(row),
    tipo,
    prefeituraId: prefeituraLegacyId,
    razaoSocial: row.razaoSocial,
    nomeFantasia: row.nomeFantasia ?? '',
    cnpj: row.cnpj ?? '',
    telefonePrincipal: row.telefonePrincipal ?? '',
    emailComercial: row.emailComercial ?? '',
    cidadeUf: row.cidadeUf ?? '',
    endereco: row.endereco ?? '',
    bandeira: row.bandeira ?? '',
    combustiveis: listaTexto(row.combustiveis),
    servicos: listaTexto(row.servicos),
    linhasAtuacao,
    segmentosAtuacao,
    categoriasServico: listaTexto(row.categoriasServico),
    especificacoes: '',
    condicaoPagamento: row.condicaoPagamento ?? '',
    limiteCredito: numero(row.limiteCredito),
    descontoComercial: row.descontoComercial ?? '',
    observacoesFaturamento: row.observacoesFaturamento ?? '',
    status: row.ativo ? 'Ativa' : row.status,
    ativo: row.ativo,
  };
}

export function mapPartnerToCredenciadaListItem(
  row: Partner,
): OficinaCredenciadaListItem {
  const shape = partnerToFirestoreShape(row);
  const mapped = {
    id: publicLegacyId(row),
    nome: nomeFromOficinaDoc(shape, publicLegacyId(row)),
    especialidade: especialidadeFromOficinaDoc(shape),
    linhasAtuacao: listaTexto(row.linhasAtuacao),
    segmentosAtuacao: listaTexto(row.segmentosAtuacao),
  };

  return {
    id: mapped.id,
    nome: mapped.nome,
    especialidade: mapped.especialidade,
    status: row.ativo ? 'Ativa' : row.status,
    parceiroId: publicLegacyId(row),
    cidadeUf: row.cidadeUf ?? '',
    linhasAtuacao: mapped.linhasAtuacao,
    segmentosAtuacao: mapped.segmentosAtuacao,
  };
}

export function mapPartnerToOficinaListItem(
  row: Partner,
  prefeituraLegacyId: string,
): OficinaListItem {
  const shape = partnerToFirestoreShape(row);
  const status = row.ativo ? 'Ativa' : row.status;

  return {
    id: publicLegacyId(row),
    nome: nomeFromOficinaDoc(shape, publicLegacyId(row)),
    razaoSocial: row.razaoSocial,
    nomeFantasia: row.nomeFantasia ?? '',
    cnpj: row.cnpj ?? '',
    cidadeUf: row.cidadeUf ?? '',
    endereco: row.endereco ?? '',
    telefonePrincipal: row.telefonePrincipal ?? '',
    emailComercial: row.emailComercial ?? '',
    especialidade: especialidadeFromOficinaDoc(shape),
    linhasAtuacao: listaTexto(row.linhasAtuacao),
    categoriasServico: listaTexto(row.categoriasServico),
    status,
    ativo: row.ativo,
    prefeituraId: prefeituraLegacyId || null,
    parceiroId: publicLegacyId(row),
    credenciadoEm: null,
    createdAt: row.createdAt.toISOString(),
  };
}
