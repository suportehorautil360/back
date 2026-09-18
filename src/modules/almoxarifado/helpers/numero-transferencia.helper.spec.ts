import { formatNumeroTransferencia, parseNumeroTransferenciaSeq } from './numero-transferencia.helper';

describe('parseNumeroTransferenciaSeq', () => {
  it('extrai a sequência do ano certo', () => {
    expect(parseNumeroTransferenciaSeq('TRF-2026-047', 2026)).toBe(47);
  });

  it('número de outro ano não conta para o MAX deste', () => {
    expect(parseNumeroTransferenciaSeq('TRF-2025-999', 2026)).toBeNull();
  });

  it('texto fora do padrão devolve null', () => {
    expect(parseNumeroTransferenciaSeq('TRF-2026-abc', 2026)).toBeNull();
  });

  it('sequência grande demais para um double devolve null, não Infinity', () => {
    // `Number('9'.repeat(400))` é Infinity. O guard existe para isto, e até
    // agora nenhum teste dos helpers-irmãos o exercia.
    expect(parseNumeroTransferenciaSeq(`TRF-2026-${'9'.repeat(400)}`, 2026)).toBeNull();
  });

  it('ano não inteiro não vira curinga na regex', () => {
    // `2026.5` interpolado faria o `.` casar qualquer caractere, e
    // 'TRF-2026X5-047' passaria por número do ano certo.
    expect(parseNumeroTransferenciaSeq('TRF-2026X5-047', 2026.5)).toBeNull();
  });

  it('passa dos 999 sem truncar, nas DUAS funções', () => {
    // `ORDER BY numero DESC` sobre TEXT põe "TRF-2026-1000" antes de
    // "TRF-2026-999", e o MAX aparente trava em 999 para sempre. É por isso
    // que o MAX sai em NÚMERO e o formato não pode truncar.
    expect(parseNumeroTransferenciaSeq('TRF-2026-1000', 2026)).toBe(1000);
    expect(formatNumeroTransferencia(2026, 1000)).toBe('TRF-2026-1000');
  });
});

describe('formatNumeroTransferencia', () => {
  it('completa com zeros até três casas', () => {
    expect(formatNumeroTransferencia(2026, 7)).toBe('TRF-2026-007');
  });
});
