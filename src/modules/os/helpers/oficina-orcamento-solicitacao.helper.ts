import { BadRequestException } from '@nestjs/common';
import type { CollectionReference } from 'firebase-admin/firestore';
import {
  parseLances,
  parseOficinasResponderam,
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

  const responderam = parseOficinasResponderam(solData.oficinasResponderam);
  if (responderam.includes(id)) {
    return true;
  }

  const lances = parseLances(solData.lances);
  return lances.some((lance) => lance.oficinaId === id && lance.valor > 0);
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
      'Vincule o checklist a uma OS com orçamento enviado.',
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
  if (!oficinaEnviouOrcamento(data, oficina)) {
    throw new BadRequestException(
      'Só é possível registrar CHE ou CHD quando a OS tiver orçamento enviado por esta oficina.',
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
