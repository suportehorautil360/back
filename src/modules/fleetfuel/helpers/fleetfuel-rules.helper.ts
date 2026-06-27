/**
 * Regras de negócio puras do FleetFuel (verificação do veículo, revisão,
 * compatibilidade de combustível e saldo). Sem I/O — fáceis de testar.
 */

/** Stringifica com segurança apenas primitivos (evita "[object Object]"). */
function toStr(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

/** Família do combustível (para checar compatibilidade veículo × bomba). */
export type FamiliaCombustivel =
  | 'gasolina'
  | 'etanol'
  | 'diesel'
  | 'gnv'
  | 'desconhecido';

/**
 * Mapeia um rótulo livre de combustível para sua família. Aceita os rótulos do
 * posto ("Diesel S-10", "Gasolina Aditivada", ...) e o campo do equipamento
 * ("Diesel", "Flex", ...).
 */
export function familiaCombustivel(valor: unknown): FamiliaCombustivel {
  const v = toStr(valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
  if (!v) return 'desconhecido';
  if (v.includes('flex')) return 'desconhecido'; // flex aceita gasolina e etanol
  if (v.includes('diesel')) return 'diesel';
  if (v.includes('gnv') || v.includes('gas natural')) return 'gnv';
  if (v.includes('etanol') || v.includes('alcool')) return 'etanol';
  if (v.includes('gasolina')) return 'gasolina';
  return 'desconhecido';
}

/**
 * Combustível selecionado na bomba é compatível com o do veículo? Quando uma das
 * famílias é desconhecida (cadastro incompleto ou veículo flex), não bloqueia.
 */
export function combustivelCompativel(
  combustivelVeiculo: unknown,
  combustivelBomba: unknown,
): boolean {
  const veiculo = familiaCombustivel(combustivelVeiculo);
  const bomba = familiaCombustivel(combustivelBomba);
  if (veiculo === 'desconhecido' || bomba === 'desconhecido') return true;
  return veiculo === bomba;
}

/**
 * Odômetro incoerente: KM informado é MENOR que a última leitura registrada do
 * veículo. Igual é aceito (veículo não rodou). `medicaoAtual` ausente/inválida
 * = sem referência (não bloqueia).
 */
export function odometroIncoerente(
  kmAtual: number,
  medicaoAtual: unknown,
): boolean {
  const km = Number(kmAtual);
  const ultima = Number(medicaoAtual);
  if (!Number.isFinite(km)) return false;
  if (!Number.isFinite(ultima)) return false;
  return km < ultima;
}

/**
 * Limite da próxima revisão = última revisão + intervalo. `null` quando não há
 * dados suficientes para calcular (não bloqueia por revisão).
 */
export function limiteRevisao(
  ultimaRevisao: unknown,
  intervaloRevisao: unknown,
): number | null {
  const base = Number(ultimaRevisao);
  const intervalo = Number(intervaloRevisao);
  if (!Number.isFinite(intervalo) || intervalo <= 0) return null;
  const baseSegura = Number.isFinite(base) ? base : 0;
  return baseSegura + intervalo;
}

/**
 * Revisão obrigatória: KM atingiu (>=) o limite da próxima revisão. Sem limite
 * calculável → não bloqueia.
 */
export function revisaoObrigatoria(
  kmAtual: number,
  ultimaRevisao: unknown,
  intervaloRevisao: unknown,
): boolean {
  const limite = limiteRevisao(ultimaRevisao, intervaloRevisao);
  const km = Number(kmAtual);
  if (limite === null || !Number.isFinite(km)) return false;
  return km >= limite;
}

/** Arredonda valor monetário para 2 casas. */
export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Saldo disponível do equipamento = total creditado − total já gasto. Nunca
 * retorna NaN; entradas inválidas contam como 0.
 */
export function calcularSaldo(creditado: unknown, gasto: unknown): number {
  const c = Number(creditado);
  const g = Number(gasto);
  return roundMoney(
    (Number.isFinite(c) ? c : 0) - (Number.isFinite(g) ? g : 0),
  );
}

/** Total do abastecimento a partir de litros × preço/litro (2 casas). */
export function calcularTotal(liters: number, pricePerLiter: number): number {
  const l = Number(liters);
  const p = Number(pricePerLiter);
  if (!Number.isFinite(l) || !Number.isFinite(p)) return 0;
  return roundMoney(l * p);
}

/** Só CPF com 11 dígitos. */
export function limparCpf(cpf: unknown): string {
  return toStr(cpf).replace(/\D/g, '');
}

/** Normaliza placa/chassi para comparação (sem máscara, maiúsculo). */
export function normalizarIdentificador(valor: unknown): string {
  return toStr(valor)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export interface CreditoSaldoInput {
  type?: string;
  equipmentId?: string | null;
  plateOrChassis?: string | null;
  amount?: unknown;
}

export interface AbastecimentoGastoInput {
  equipmentId?: string;
  total?: unknown;
}

/**
 * Soma os créditos lançados para um equipamento. Casa pelo `equipmentId` ou,
 * em fallback, pela placa/chassi normalizada (docs sem equipmentId). Pura.
 */
export function somaCreditadoEquipamento(
  creditos: CreditoSaldoInput[],
  equipmentId: string,
  identificadores: string[],
): number {
  const idsNorm = new Set(
    identificadores.map(normalizarIdentificador).filter(Boolean),
  );
  let total = 0;
  for (const credito of creditos) {
    if (credito.type !== 'equipment') continue;
    const casaPorId = !!equipmentId && credito.equipmentId === equipmentId;
    const casaPorPlaca =
      !!credito.plateOrChassis &&
      idsNorm.has(normalizarIdentificador(credito.plateOrChassis));
    if (!casaPorId && !casaPorPlaca) continue;
    const amount = Number(credito.amount);
    if (Number.isFinite(amount)) total += amount;
  }
  return roundMoney(total);
}

/** Soma o total já gasto (abastecimentos) de um equipamento. Pura. */
export function somaGastoEquipamento(
  abastecimentos: AbastecimentoGastoInput[],
  equipmentId: string,
): number {
  let total = 0;
  for (const item of abastecimentos) {
    if (item.equipmentId !== equipmentId) continue;
    const valor = Number(item.total);
    if (Number.isFinite(valor) && valor > 0) total += valor;
  }
  return roundMoney(total);
}
