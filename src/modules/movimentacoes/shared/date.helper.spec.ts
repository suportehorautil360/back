import { BadRequestException } from '@nestjs/common';
import { parseDateEnd, parseDateStart } from './date.helper';

describe('parseDateStart / parseDateEnd', () => {
  it('trata YYYY-MM-DD como dia de calendário em UTC (inclusivo)', () => {
    expect(parseDateStart('2026-07-01', 'startDate').toISOString()).toBe(
      '2026-07-01T00:00:00.000Z',
    );
    expect(parseDateEnd('2026-07-31', 'endDate').toISOString()).toBe(
      '2026-07-31T23:59:59.999Z',
    );
  });

  it('inclui abastecimento no último dia do mês', () => {
    const start = parseDateStart('2026-07-01', 'startDate').toISOString();
    const end = parseDateEnd('2026-07-31', 'endDate').toISOString();
    const createdAt = '2026-07-31T20:15:00.000Z';
    expect(createdAt >= start && createdAt <= end).toBe(true);
  });

  it('rejeita data inválida', () => {
    expect(() => parseDateStart('nao-e-data', 'startDate')).toThrow(
      BadRequestException,
    );
  });
});
