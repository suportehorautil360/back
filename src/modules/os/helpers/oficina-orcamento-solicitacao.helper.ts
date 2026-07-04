import { BadRequestException } from '@nestjs/common';
import type { CollectionReference } from 'firebase-admin/firestore';
import {
  parseLances,
  resolveOficinaVencedoraId,
} from './lances-os.helper';

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

export function oficinaEnviouOrcamento(
  solData: Record<string, unknown>,
  oficinaId: string,
): boolean {
  const id = texto(oficinaId);
  if (!id) return false;

  const lances = parseLances(solData.lances);
  return lances.some((lance) => lance.oficinaId === id && lance.valor > 0);
}

export function oficinaTemOrcamentoAprovado(
  solData: Record<string, unknown>,
  oficinaId: string,
): boolean {
  const id = texto(oficinaId);
  if (!id) return false;

  const lances = parseLances(solData.lances);
  const vencedoraId = resolveOficinaVencedoraId(solData, lances);

  return vencedoraId === id;
}

export async function assertOficinaTemOrcamentoNaSolicitacao(
  solicitacoesCollection: CollectionReference,
  solicitacaoOsId: string,
  oficinaId: string,
): Promise<void> {
  const solId = texto(solicitacaoOsId);
  const oficina = texto(oficinaId);

  if (!solId) {
    throw new BadRequestException(
      'Vincule o checklist a uma OS com orçamento aprovado.',
    );
  }

  if (!oficina) {
    throw new BadRequestException('oficinaId é obrigatório.');
  }

  const snap = await solicitacoesCollection.doc(solId).get();
  if (!snap.exists) {
    throw new BadRequestException(
      'Solicitação de OS não encontrada para validar o orçamento.',
    );
  }

  const data = snap.data() as Record<string, unknown>;
  if (!oficinaTemOrcamentoAprovado(data, oficina)) {
    throw new BadRequestException(
      'Só é possível registrar CHE ou CHD quando o orçamento desta oficina for aprovado pela prefeitura.',
    );
  }
}

export async function resolveSolicitacaoIdPorProtocolo(
  solicitacoesCollection: CollectionReference,
  protocolo: string,
): Promise<string | null> {
  const value = texto(protocolo);
  if (!value) return null;

  const snap = await solicitacoesCollection
    .where('protocolo', '==', value)
    .limit(1)
    .get();

  if (snap.empty) return null;

  return snap.docs[0].id;
}
