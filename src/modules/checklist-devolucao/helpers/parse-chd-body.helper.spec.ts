import { parseChdRequestBody } from './parse-chd-body.helper';
import { extractPartsFromPayload } from './normalize-chd-payload.helper';

describe('parse-chd-body.helper', () => {
  it('desembrulha campo data (multipart)', () => {
    const payload = {
      parts: {
        items: [{ description: 'PEÇA 01', partNumber: '345', brand: 'HONDA' }],
      },
    };
    const dto = parseChdRequestBody({
      data: JSON.stringify(payload),
    });
    expect(extractPartsFromPayload(dto)).toHaveLength(1);
  });

  it('normaliza parts como array na raiz', () => {
    const dto = parseChdRequestBody({
      oficinaId: 'of-1',
      parts: [{ description: 'Filtro', partNumber: '1', brand: 'X' }],
    });
    expect(extractPartsFromPayload(dto)).toHaveLength(1);
  });

  it('parseia parts quando vem como string JSON', () => {
    const dto = parseChdRequestBody({
      oficinaId: 'of-1',
      parts: JSON.stringify({
        items: [{ description: 'Filtro', partNumber: '1', brand: 'X' }],
      }),
    });
    expect(extractPartsFromPayload(dto)).toHaveLength(1);
  });
});
