import {
  extractPartsFromPayload,
  extractPartsFromPatchBody,
  normalizePartItem,
  normalizeServiceItem,
} from './normalize-chd-payload.helper';

describe('normalize-chd-payload.helper', () => {
  it('aceita pecas com campos em português', () => {
    const items = extractPartsFromPayload({
      pecas: [
        {
          descricao: 'Retentor bomba',
          numeroPeca: '9920034',
          marca: 'Komatsu',
          destinacaoPecaVelha: 'Descarte ecológico',
          fotoNova: 'https://a/new.jpg',
        },
      ],
    } as never);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      description: 'Retentor bomba',
      partNumber: '9920034',
      brand: 'Komatsu',
      oldPartDestination: 'Descarte ecológico',
      newPhoto: 'https://a/new.jpg',
    });
  });

  it('aceita parts como array direto', () => {
    const item = normalizePartItem({
      description: 'Filtro',
      partNumber: '123',
      brand: 'CAT',
      oldPartDestination: 'Devolvida ao cliente',
    });
    expect(item?.description).toBe('Filtro');
  });

  it('aceita parts.items em JSON string (multipart)', () => {
    const items = extractPartsFromPayload({
      parts: JSON.stringify([
        { description: 'Correia', partNumber: 'X1', brand: 'Y', oldPartDestination: 'descarte' },
      ]),
    } as never);
    expect(items).toHaveLength(1);
    expect(items[0].oldPartDestination).toBe('Descarte ecológico');
  });

  it('parseia parts.items no PATCH de fotos', () => {
    const items = extractPartsFromPatchBody({
      items: [
        {
          description: 'PEÇA 02',
          partNumber: '4345',
          brand: 'Honda',
          oldPartDestination: 'Descarte ecológico',
          newPhoto: 'https://x/new.jpg',
        },
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0].description).toBe('PEÇA 02');
  });
});
