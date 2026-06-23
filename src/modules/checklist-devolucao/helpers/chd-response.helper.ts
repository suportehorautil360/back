import { BadRequestException } from '@nestjs/common';
import type { ChecklistDevolucaoDoc } from '../checklist-devolucao.types';

export type ChdFieldMessage = {
  count?: number;
  message: string;
};

export type ChdResponseFields = Record<string, ChdFieldMessage>;

export function buildChdCreateResponseFields(
  doc: ChecklistDevolucaoDoc,
  partsHint = 0,
): ChdResponseFields {
  const partsCount = doc.parts.items.length;
  const servicesCount = doc.services.items.length;

  return {
    'parts.items': {
      count: partsCount,
      message:
        partsCount > 0
          ? `${partsCount} peça(s) salva(s) em parts.items`
          : partsHint > 0
            ? 'Peças enviadas no body, mas não interpretadas — use application/json ou campo data'
            : 'Nenhuma peça no payload (parts.items vazio ou ausente)',
    },
    'services.items': {
      count: servicesCount,
      message:
        servicesCount > 0
          ? `${servicesCount} serviço(s) salvo(s) em services.items`
          : 'Nenhum serviço no payload',
    },
    'identification.date': {
      message: doc.identification.date
        ? 'Data de devolução registrada'
        : 'identification.date ausente',
    },
    'identification.os': {
      message: doc.identification.os
        ? `Protocolo da O.S. vinculado: ${doc.identification.os}`
        : 'Protocolo da O.S. não informado',
    },
  };
}

export function chdBadRequest(
  message: string,
  fields: ChdResponseFields,
): BadRequestException {
  return new BadRequestException({ message, fields });
}
