import type { InsumoDoc } from '../insumos.types';

function texto(valor: unknown): string {
  if (typeof valor === 'string') return valor.trim();
  if (typeof valor === 'number' && Number.isFinite(valor)) return String(valor);
  return '';
}

function numero(valor: unknown): number {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  if (typeof valor === 'string' && valor.trim()) {
    const n = Number(valor.replace(',', '.'));
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

export function isItemOrcamentoInsumo(item: Record<string, unknown>): boolean {
  const category = texto(item.category).toLowerCase();
  if (
    category === 'service' ||
    category === 'servico' ||
    category === 'travel' ||
    category === 'deslocamento'
  ) {
    return false;
  }
  if (
    category === 'part' ||
    category === 'peca' ||
    category === 'material' ||
    category === 'insumo'
  ) {
    return true;
  }

  const desc = texto(item.descricao) || texto(item.description);
  if (!desc) return false;

  if (extrairCodigoOrcamento(item)) return true;
  if (numero(item.valor ?? item.value) > 0) return true;
  if (numero(item.quantity ?? item.quantidade) > 0) return true;

  return true;
}

function extrairCodigoOrcamento(item: Record<string, unknown>): string {
  return (
    texto(item.code) ||
    texto(item.codigo) ||
    texto(item.produto) ||
    texto(item.codigoPeca) ||
    texto(item.codPeca) ||
    texto(item.partNumber) ||
    texto(item.part_number) ||
    texto(item.numeroPeca)
  );
}

export function derivarInsumosDeOrcamentoItem(
  ordemId: string,
  item: Record<string, unknown>,
  index: number,
): InsumoDoc | null {
  if (!isItemOrcamentoInsumo(item)) return null;

  const descricao = texto(item.descricao) || texto(item.description);
  if (!descricao) return null;

  const codigo = extrairCodigoOrcamento(item);
  const qtd = numero(item.quantity ?? item.quantidade) || 1;
  const vlrUnit =
    numero(item.unitValue ?? item.valorUnitario) ||
    (qtd > 0 ? numero(item.valor ?? item.value) / qtd : 0);
  const total = numero(item.valor ?? item.value) || qtd * vlrUnit;

  return {
    id: `${ordemId}-orc-${index}`,
    codigo,
    descricao,
    marca: texto(item.brand) || texto(item.marca) || null,
    qtd,
    unid: 'UN',
    vlrUnit,
    total,
    ordemServicoId: ordemId,
  };
}
