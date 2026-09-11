/**
 * O token que o login por CHASSI passa a emitir.
 *
 * Até aqui esse login não produzia credencial nenhuma: o servidor resolvia a
 * empresa do chassi e devolvia o id para o cliente guardar. Funcionava
 * enquanto o catálogo de checklists era único e global. Deixou de funcionar
 * quando a definição passou a poder ser DE UMA EMPRESA — sem credencial, o
 * servidor não tem como saber para quem responder, e o operador do chassi
 * recebia o catálogo base mesmo na empresa que personalizou o dela.
 *
 * A alternativa era o cliente MANDAR a empresa na requisição. É exatamente o
 * antipadrão que este produto já paga em outros cantos: quem afirma quem é
 * não pode ser quem pergunta.
 *
 * ─── O que este token NÃO é ─────────────────────────────────────────────
 *
 * Não é sessão de pessoa. O chassi identifica uma MÁQUINA — qualquer um com o
 * número do chassi entra, e é assim de propósito: o operador no pátio não tem
 * cadastro, e o nome dele é digitado na hora. Por isso o payload traz
 * `tipo: 'chassi'` e não `funcionarioId`: quem ler este token sabe que tem uma
 * máquina identificada, não uma pessoa autenticada, e não pode confundir as
 * duas na hora de autorizar.
 *
 * O que ele habilita é leitura de catálogo recortada por empresa. Nada que
 * exija pessoa deve aceitá-lo — para isso existe o `OperadorGuard`, que exige
 * `tipo: 'operador'` e `funcionarioId`.
 */

/** 12h: cobre o turno mais longo e morre antes de o aparelho trocar de mão. */
export const VALIDADE_DO_TOKEN_DE_CHASSI = '12h';

export interface PayloadDoChassi {
  /// O chassi, normalizado. É o "quem" possível aqui.
  sub: string;
  /// Lido por quem autoriza para NÃO tratar isto como pessoa.
  tipo: 'chassi';
  /// UUID da empresa em Postgres — nunca o `legacyId`, que é chave do
  /// Firestore antigo e não serve de filtro nas tabelas novas.
  companyId: string;
  /// O equipamento resolvido, para rastrear qual máquina abriu a sessão.
  idMaquina: string;
}

export function montarPayloadDoChassi(entrada: {
  chassi: string;
  companyId: string;
  idMaquina: string;
}): PayloadDoChassi {
  return {
    sub: entrada.chassi,
    tipo: 'chassi',
    companyId: entrada.companyId,
    idMaquina: entrada.idMaquina,
  };
}

/**
 * O token é de MÁQUINA?
 *
 * Usado por quem autoriza para separar os dois mundos. Um payload que diga
 * `tipo: 'chassi'` mas venha sem `companyId` não serve para nada e é tratado
 * como não-chassi: o único poder deste token é dizer de que empresa é a
 * leitura, e sem a empresa ele não diz nada.
 */
export function ehTokenDeChassi(payload: unknown): payload is PayloadDoChassi {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as Record<string, unknown>;
  return (
    p.tipo === 'chassi' &&
    typeof p.companyId === 'string' &&
    p.companyId.trim() !== ''
  );
}
