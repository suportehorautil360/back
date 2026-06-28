import { BadRequestException } from '@nestjs/common';

/** Sanitiza segmento de path no bucket (sem traversal). */
export function sanitizarPathSegmento(valor: string): string {
  return valor.replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-');
}

/**
 * Pasta no Storage para agrupar fotos.
 * Aceita checklistId (uuid gerado no front antes de salvar) OU oficinaId + os.
 */
export function resolveUploadFolder(params: {
  checklistId?: string;
  abastecimentoId?: string;
  oficinaId?: string;
  os?: string;
}): string {
  const abastecimentoId = params.abastecimentoId?.trim();
  if (abastecimentoId) {
    return `abastecimentos/${sanitizarPathSegmento(abastecimentoId)}`;
  }

  const checklistId = params.checklistId?.trim();
  if (checklistId) return sanitizarPathSegmento(checklistId);

  const oficinaId = params.oficinaId?.trim();
  const os = params.os?.trim();

  if (!oficinaId) {
    throw new BadRequestException(
      'Informe checklistId (uuid gerado no formulário) ou oficinaId + os (protocolo da O.S.).',
    );
  }

  const pastaOficina = sanitizarPathSegmento(oficinaId);
  if (os) {
    return `${pastaOficina}/${sanitizarPathSegmento(os)}`;
  }
  return pastaOficina;
}
