import { buildChecklistChegadaDoc, mapChecklistItems } from './checklist-chegada.mapper';
import type { CreateChecklistChegadaDto } from '../dto/create-checklist-chegada.dto';

describe('checklist-chegada.mapper', () => {
  it('normaliza itens de inspeção', () => {
    expect(
      mapChecklistItems({
        vidros: { status: 'ok' },
        retrovisores: {
          status: 'anomaly',
          photo: 'https://x/y.jpg',
          description: 'Espelho trincado',
        },
        limpadores: { status: 'na' },
      }),
    ).toEqual({
      vidros: { status: 'ok' },
      retrovisores: {
        status: 'anomaly',
        photo: 'https://x/y.jpg',
        description: 'Espelho trincado',
      },
      limpadores: { status: 'na' },
    });
  });

  it('monta documento com id e createdAt', () => {
    const dto = {
      oficinaId: 'of-1',
      identification: {
        os: 'OS-2026-004',
        entryDate: '2026-06-16',
        time: '14:30',
        responsible: 'João',
        client: 'Prefeitura X',
        brandModel: 'CAT 320',
        platePrefix: 'ABC-1234',
        km: '15000',
        hourMeter: '2450',
        fuel: '1/2',
      },
      photos: { frontal: 'https://a/1.jpg' },
      inspection: { vidros: { status: 'ok' } },
      blocks: { hidraulico: { status: 'ok' } },
      term: {
        symptoms: 'Barulho',
        clientSignature: 'Maria',
        workshopSignature: 'Carlos',
      },
    } as CreateChecklistChegadaDto;

    const doc = buildChecklistChegadaDoc(
      'uuid-1',
      'CHE-2026-0001',
      dto,
      '2026-06-16T14:30:00.000Z',
    );

    expect(doc.id).toBe('uuid-1');
    expect(doc.number).toBe('CHE-2026-0001');
    expect(doc.createdAt).toBe('2026-06-16T14:30:00.000Z');
    expect(doc.identification.os).toBe('OS-2026-004');
  });
});
