import { ehComboioTipo } from './equipment-api.mapper';

/**
 * Que equipamentos contam para liberar o login de campo.
 *
 * O portão existe para que só quem realmente opera equipamento entre no app
 * de campo. Cada app tem um recorte diferente:
 *  - `comboio`          → PWA comboista (padrão histórico);
 *  - `fora-de-comboio`  → FleetFuel/motorista;
 *  - `qualquer`         → app do operador de checklist, que roda tanto em
 *                         comboio quanto em qualquer outro equipamento.
 */
export type EscopoCondutor = 'comboio' | 'fora-de-comboio' | 'qualquer';

export function escopoDoApp(app: string | undefined): EscopoCondutor {
  if (app === 'checklist') return 'qualquer';
  if (app === 'motorista') return 'fora-de-comboio';
  // Padrão histórico: sem `app`, é o PWA comboista.
  return 'comboio';
}

export function equipamentoNoEscopo(
  tipo: unknown,
  escopo: EscopoCondutor,
): boolean {
  if (escopo === 'qualquer') return true;
  const isComboio = ehComboioTipo(tipo);
  return escopo === 'comboio' ? isComboio : !isComboio;
}
