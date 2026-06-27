import { nomeFromOficinaDoc } from '../../os/helpers/especialidade-oficina.helper';
import { timestampToIso } from '../../os/helpers/timestamp.helper';
import type { NotaFiscalApiItem } from '../notas-fiscais.types';
import type { ListNotasFiscaisPrefeituraQueryDto } from '../dto/list-notas-fiscais-prefeitura-query.dto';
import {
  parseDateEnd,
  parseDateStart,
} from '../../movimentacoes/shared/date.helper';

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

function numero(valor: unknown): number {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;
  if (typeof valor === 'string') {
    const n = Number(valor.replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export interface NotaFiscalPrefeituraListItem extends NotaFiscalApiItem {
  oficinaNome: string;
  osProtocolo: string;
  osEquipamento: string;
  ordemServicoId?: string;
}

export interface OsResolucaoMaps {
  solicitacoes: Map<string, Record<string, unknown>>;
  ordensPorId: Map<string, Record<string, unknown>>;
  ordensPorOficina: Map<string, Array<{ id: string; data: Record<string, unknown> }>>;
}

export interface OsContextoResolvido {
  osProtocolo: string;
  osEquipamento: string;
  solicitacaoOsId: string;
  ordemServicoId: string;
}

export function buildOsResolucaoMaps(
  solicitacoes: Array<{ id: string; data: Record<string, unknown> }>,
  ordens: Array<{ id: string; data: Record<string, unknown> }>,
): OsResolucaoMaps {
  const solicitacoesMap = new Map<string, Record<string, unknown>>();
  for (const sol of solicitacoes) {
    solicitacoesMap.set(sol.id, sol.data);
  }

  const ordensPorId = new Map<string, Record<string, unknown>>();
  const ordensPorOficina = new Map<
    string,
    Array<{ id: string; data: Record<string, unknown> }>
  >();

  for (const ordem of ordens) {
    ordensPorId.set(ordem.id, ordem.data);
    const oficinaId = texto(ordem.data.oficinaId);
    if (!oficinaId) continue;
    const lista = ordensPorOficina.get(oficinaId) ?? [];
    lista.push(ordem);
    ordensPorOficina.set(oficinaId, lista);
  }

  for (const [oficinaId, lista] of ordensPorOficina) {
    lista.sort((a, b) =>
      isoOrdem(b.data).localeCompare(isoOrdem(a.data)),
    );
    ordensPorOficina.set(oficinaId, lista);
  }

  return {
    solicitacoes: solicitacoesMap,
    ordensPorId,
    ordensPorOficina,
  };
}

function isoOrdem(data: Record<string, unknown>): string {
  return timestampToIso(data.criadoEm ?? data.createdAt ?? data.aprovadoEm);
}

function protocoloFromOrdemDoc(data: Record<string, unknown> | undefined): string {
  if (!data) return '';
  return texto(data.protocolo) || texto(data.protocol);
}

function equipamentoFromOrdemDoc(data: Record<string, unknown> | undefined): string {
  if (!data) return '';
  return texto(data.equipamento) || texto(data.equipment);
}

function valorOrdem(data: Record<string, unknown>): number {
  return numero(data.valorTotal ?? data.totalValue);
}

function ordemAprovada(data: Record<string, unknown>): boolean {
  const status = texto(data.status).toLowerCase();
  return status === 'aprovado' || status === 'concluido';
}

function valoresProximos(a: number, b: number): boolean {
  if (a <= 0 || b <= 0) return false;
  const diff = Math.abs(a - b);
  return diff <= 1 || diff / Math.max(a, b) <= 0.02;
}

function contextoFromSolicitacao(
  solId: string,
  maps: OsResolucaoMaps,
  oficinaId: string,
): OsContextoResolvido | null {
  const sol = maps.solicitacoes.get(solId);
  if (!sol) return null;

  const protocolo = protocoloFromSolicitacaoDoc(sol);
  const equipamento = equipamentoFromSolicitacaoDoc(sol);
  const ordemAprovadaId = texto(sol.ordemServicoAprovadaId);
  const ordemMatch = maps.ordensPorOficina
    .get(oficinaId)
    ?.find((o) => texto(o.data.solicitacaoOsId) === solId);
  const ordemData =
    (ordemAprovadaId ? maps.ordensPorId.get(ordemAprovadaId) : undefined) ??
    ordemMatch?.data;

  return {
    osProtocolo: protocolo || protocoloFromOrdemDoc(ordemData),
    osEquipamento: equipamento || equipamentoFromOrdemDoc(ordemData),
    solicitacaoOsId: solId,
    ordemServicoId: ordemAprovadaId || ordemMatch?.id || '',
  };
}

function contextoFromOrdem(
  ordemId: string,
  ordemData: Record<string, unknown>,
  maps: OsResolucaoMaps,
): OsContextoResolvido {
  const solId = texto(ordemData.solicitacaoOsId);
  const sol = solId ? maps.solicitacoes.get(solId) : undefined;

  return {
    osProtocolo:
      protocoloFromSolicitacaoDoc(sol) || protocoloFromOrdemDoc(ordemData),
    osEquipamento:
      equipamentoFromSolicitacaoDoc(sol) || equipamentoFromOrdemDoc(ordemData),
    solicitacaoOsId: solId,
    ordemServicoId: ordemId,
  };
}

function inferirOrdemPorOficina(
  nf: NotaFiscalApiItem,
  maps: OsResolucaoMaps,
): { id: string; data: Record<string, unknown> } | null {
  const ordens = maps.ordensPorOficina.get(nf.oficinaId) ?? [];
  if (ordens.length === 0) return null;

  const nfIso = nf.createdAt;
  const aprovadas = ordens.filter((o) => ordemAprovada(o.data));
  const candidatas = aprovadas.length > 0 ? aprovadas : ordens;

  const porValor = candidatas.filter((o) =>
    valoresProximos(valorOrdem(o.data), nf.value),
  );
  if (porValor.length === 1) return porValor[0];

  const porData = candidatas.filter((o) => isoOrdem(o.data) <= nfIso);
  if (porData.length > 0) return porData[0];

  return candidatas[0] ?? null;
}

/** Cruza NF com solicitacoesOS / ordensServico para obter número da O.S. */
export function resolverOsDaNotaFiscal(
  nf: NotaFiscalApiItem & { ordemServicoId?: string },
  maps: OsResolucaoMaps,
): OsContextoResolvido {
  const solIdInformado = texto(nf.solicitacaoOsId);
  if (solIdInformado) {
    const ctx = contextoFromSolicitacao(solIdInformado, maps, nf.oficinaId);
    if (ctx?.osProtocolo) return ctx;
    if (ctx) return ctx;
  }

  const ordemIdInformado = texto(nf.ordemServicoId);
  if (ordemIdInformado) {
    const ordemData = maps.ordensPorId.get(ordemIdInformado);
    if (ordemData) {
      return contextoFromOrdem(ordemIdInformado, ordemData, maps);
    }
  }

  const ordensOficina = maps.ordensPorOficina.get(nf.oficinaId) ?? [];
  for (const ordem of ordensOficina) {
    const solId = texto(ordem.data.solicitacaoOsId);
    if (!solId) continue;
    const sol = maps.solicitacoes.get(solId);
    if (!sol) continue;
    if (
      texto(sol.ordemServicoAprovadaId) === ordem.id &&
      ordemAprovada(ordem.data)
    ) {
      const ctx = contextoFromOrdem(ordem.id, ordem.data, maps);
      if (ctx.osProtocolo) return ctx;
    }
  }

  const inferida = inferirOrdemPorOficina(nf, maps);
  if (inferida) {
    return contextoFromOrdem(inferida.id, inferida.data, maps);
  }

  return {
    osProtocolo: '',
    osEquipamento: '',
    solicitacaoOsId: solIdInformado,
    ordemServicoId: ordemIdInformado,
  };
}

export function enriquecerNotaFiscalPrefeitura(
  item: NotaFiscalApiItem,
  maps: OsResolucaoMaps,
  oficinaData: Record<string, unknown> | undefined,
): NotaFiscalPrefeituraListItem {
  const os = resolverOsDaNotaFiscal(item, maps);

  return {
    ...item,
    ...(os.solicitacaoOsId && !item.solicitacaoOsId
      ? { solicitacaoOsId: os.solicitacaoOsId }
      : {}),
    ...(os.ordemServicoId ? { ordemServicoId: os.ordemServicoId } : {}),
    oficinaNome: nomeOficinaFromDoc(oficinaData, item.oficinaId),
    osProtocolo: os.osProtocolo,
    osEquipamento: os.osEquipamento,
  };
}

export function filtrarNotasFiscaisPrefeitura(
  itens: NotaFiscalPrefeituraListItem[],
  query: ListNotasFiscaisPrefeituraQueryDto,
): NotaFiscalPrefeituraListItem[] {
  const busca = texto(query.busca).toLowerCase();
  const oficinaId = texto(query.oficinaId);
  const status = texto(query.status) || 'todos';
  const startIso = texto(query.startDate)
    ? parseDateStart(texto(query.startDate), 'startDate').toISOString()
    : '';
  const endIso = texto(query.endDate)
    ? parseDateEnd(texto(query.endDate), 'endDate').toISOString()
    : '';

  return itens.filter((item) => {
    if (oficinaId && item.oficinaId !== oficinaId) return false;
    if (status !== 'todos' && item.status !== status) return false;

    if (startIso && item.createdAt < startIso) return false;
    if (endIso && item.createdAt > endIso) return false;

    if (!busca) return true;

    const haystack = [
      item.number,
      item.issuerName,
      item.oficinaNome,
      item.osProtocolo,
      item.osEquipamento,
      item.solicitacaoOsId,
      item.accessKey,
      item.description,
    ]
      .join(' ')
      .toLowerCase();

    return haystack.includes(busca);
  });
}

export function nomeOficinaFromDoc(
  data: Record<string, unknown> | undefined,
  oficinaId: string,
): string {
  if (!data) return oficinaId;
  return nomeFromOficinaDoc(data, oficinaId);
}

export function protocoloFromSolicitacaoDoc(
  data: Record<string, unknown> | undefined,
): string {
  if (!data) return '';
  return texto(data.protocolo) || texto(data.protocol);
}

export function equipamentoFromSolicitacaoDoc(
  data: Record<string, unknown> | undefined,
): string {
  if (!data) return '';
  return texto(data.equipamento) || texto(data.equipment);
}

export function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
