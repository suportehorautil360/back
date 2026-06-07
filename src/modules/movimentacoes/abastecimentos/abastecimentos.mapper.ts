/** Shape unificado de um abastecimento (Comboio ou Posto). */
export type OrigemAbastecimento = 'comboio' | 'posto';
export type UnidadeLeitura = 'km' | 'h';

export interface Abastecimento {
  id: string;
  data: string; // YYYY-MM-DD
  hora: string; // HH:MM
  origem: OrigemAbastecimento;
  veiculo: string;
  placa: string;
  tipoVeiculo: string;
  combustivel: string;
  litros: number;
  /** 0 quando comboio; o front mostra "—" se origem === 'comboio'. */
  valor: number;
  leitura: number; // km ou horas (horímetro)
  leituraUnidade: UnidadeLeitura;
  local: string;
  // Compat com consumidores atuais (dashboard, relatórios):
  km: number;
  postoNome: string;
  status: string;
}

type Doc = Record<string, unknown> & { id?: string };

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Converte "R$ 1.234,56" (ou número) em número. */
function parseValor(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v !== 'string') return 0;
  const limpo = v
    .replace(/[^0-9,.-]/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const n = Number(limpo);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Mapeia um doc cru da coleção `abastecimentos` para o shape unificado.
 * Hoje os registros são de Posto; o mapper já entende `origem: 'comboio'`,
 * `leituraUnidade: 'h'` e `local` para quando a captura do comboio existir.
 */
export function mapAbastecimento(doc: Doc): Abastecimento {
  const origem: OrigemAbastecimento =
    doc.origem === 'comboio' ? 'comboio' : 'posto';
  const leituraUnidade: UnidadeLeitura =
    doc.leituraUnidade === 'h' || (origem === 'comboio' && doc.leituraUnidade == null)
      ? 'h'
      : 'km';
  const leitura = num(doc.leitura ?? doc.km ?? doc.horimetro);
  const valor = origem === 'comboio' ? 0 : parseValor(doc.valorTotal ?? doc.valor);
  const local = str(doc.local ?? doc.postoNome);

  return {
    id: str(doc.id),
    data: str(doc.data),
    hora: str(doc.hora),
    origem,
    veiculo: str(doc.veiculo),
    placa: str(doc.placa),
    tipoVeiculo: str(doc.tipoVeiculo ?? doc.tipo),
    combustivel: str(doc.combustivel) || '—',
    litros: num(doc.litros),
    valor,
    leitura,
    leituraUnidade,
    local,
    km: leituraUnidade === 'km' ? leitura : 0,
    postoNome: str(doc.postoNome ?? local),
    status: str(doc.status).toLowerCase(),
  };
}
