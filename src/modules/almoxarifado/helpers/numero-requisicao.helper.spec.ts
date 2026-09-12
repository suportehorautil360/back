import { formatNumeroRequisicao, parseNumeroRequisicaoSeq } from './numero-requisicao.helper';

describe('parseNumeroRequisicaoSeq', () => {
  it('extrai a sequência do número', () => {
    expect(parseNumeroRequisicaoSeq('REQ-2026-047', 2026)).toBe(47);
  });

  it('extrai sequência de 4 dígitos sem truncar', () => {
    // É exatamente o caso do achado C1: depois da 999ª requisição do ano.
    expect(parseNumeroRequisicaoSeq('REQ-2026-1000', 2026)).toBe(1000);
  });

  it('devolve null para ano diferente', () => {
    expect(parseNumeroRequisicaoSeq('REQ-2025-001', 2026)).toBeNull();
  });

  it('devolve null para número fora do padrão', () => {
    expect(parseNumeroRequisicaoSeq('qualquer-coisa', 2026)).toBeNull();
  });
});

describe('formatNumeroRequisicao', () => {
  it('formata com 3 dígitos', () => {
    expect(formatNumeroRequisicao(2026, 7)).toBe('REQ-2026-007');
  });

  it('não trunca quando a sequência já passou de 3 dígitos', () => {
    expect(formatNumeroRequisicao(2026, 1000)).toBe('REQ-2026-1000');
  });
});

describe('MAX numérico vs. MAX lexicográfico (o bug do achado C1)', () => {
  it('"REQ-2026-1000" é MAIOR em número mas MENOR em string que "REQ-2026-999"', () => {
    // A prova de que `orderBy: { numero: 'desc' }` numa coluna TEXT não serve
    // para achar o próximo número: comparando como STRING, "999" vence
    // "1000" porque '9' > '1' no primeiro caractere que difere.
    expect('REQ-2026-999' > 'REQ-2026-1000').toBe(true);
    // Mas em número, é o oposto — e é esse o que importa.
    const seqAntiga = parseNumeroRequisicaoSeq('REQ-2026-999', 2026)!;
    const seqNova = parseNumeroRequisicaoSeq('REQ-2026-1000', 2026)!;
    expect(seqNova).toBeGreaterThan(seqAntiga);
  });

  it('o próximo número depois de existirem 999 e 1000 é 1001, nunca repete', () => {
    const existentes = ['REQ-2026-001', 'REQ-2026-999', 'REQ-2026-1000'];
    const ano = 2026;
    let maxSeq = 0;
    for (const numero of existentes) {
      const seq = parseNumeroRequisicaoSeq(numero, ano);
      if (seq !== null && seq > maxSeq) maxSeq = seq;
    }
    expect(formatNumeroRequisicao(ano, maxSeq + 1)).toBe('REQ-2026-1001');
  });
});
