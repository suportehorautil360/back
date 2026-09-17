import { formatNumeroInventario, parseNumeroInventarioSeq } from './numero-inventario.helper';

describe('parseNumeroInventarioSeq', () => {
  it('extrai a sequência do ano certo', () => {
    expect(parseNumeroInventarioSeq('INV-2026-047', 2026)).toBe(47);
  });

  it('número de outro ano não conta para o MAX deste', () => {
    expect(parseNumeroInventarioSeq('INV-2025-999', 2026)).toBeNull();
  });

  it('texto que não é numeração devolve null em vez de NaN', () => {
    expect(parseNumeroInventarioSeq('INV-2026-abc', 2026)).toBeNull();
  });

  it('passa dos 999 sem truncar — é o defeito que a numeração da requisição teve', () => {
    // `ORDER BY numero DESC` sobre TEXT põe "INV-2026-1000" ANTES de
    // "INV-2026-999" ('1' < '9'), e o MAX aparente trava em 999 para sempre.
    // Por isso o MAX sai em NÚMERO, e o formato não pode truncar.
    expect(parseNumeroInventarioSeq('INV-2026-1000', 2026)).toBe(1000);
    expect(formatNumeroInventario(2026, 1000)).toBe('INV-2026-1000');
  });
});

describe('formatNumeroInventario', () => {
  it('completa com zeros até três casas', () => {
    expect(formatNumeroInventario(2026, 7)).toBe('INV-2026-007');
  });
});
