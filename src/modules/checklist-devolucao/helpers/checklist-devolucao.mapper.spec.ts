import {
  buildChecklistDevolucaoDoc,
  mapGeneralStateItems,
  mapModuleItems,
  mapPartItems,
} from './checklist-devolucao.mapper';
import type { CreateChecklistDevolucaoDto } from '../dto/create-checklist-devolucao.dto';

describe('checklist-devolucao.mapper', () => {
  it('normaliza itens do estado geral', () => {
    expect(
      mapGeneralStateItems({
        limpezaInterna: { status: 'ok' },
        limpezaExterna: {
          status: 'anomaly',
          photo: 'https://x/y.jpg',
          description: 'Arranhão na lateral',
        },
        vidros: { status: 'na' },
      }),
    ).toEqual({
      limpezaInterna: { status: 'ok' },
      limpezaExterna: {
        status: 'anomaly',
        photo: 'https://x/y.jpg',
        description: 'Arranhão na lateral',
      },
      vidros: { status: 'na' },
    });
  });

  it('normaliza itens dos módulos com foto e descrição', () => {
    expect(
      mapModuleItems({
        sistemaHidraulico: { status: 'ok' },
        sistemaEletrico: {
          status: 'anomaly',
          photo: 'https://x/mod.jpg',
          description: 'Fiação exposta',
        },
      }),
    ).toEqual({
      sistemaHidraulico: { status: 'ok' },
      sistemaEletrico: {
        status: 'anomaly',
        photo: 'https://x/mod.jpg',
        description: 'Fiação exposta',
      },
    });
  });

  it('mapeia peças com fotos', () => {
    expect(
      mapPartItems([
        {
          description: 'Retentor',
          partNumber: '9920034',
          brand: 'Komatsu',
          oldPartDestination: 'Descarte ecológico',
          newPhoto: 'https://a/new.jpg',
          replacedPhoto: 'https://a/old.jpg',
        },
      ]),
    ).toEqual([
      {
        description: 'Retentor',
        partNumber: '9920034',
        brand: 'Komatsu',
        oldPartDestination: 'Descarte ecológico',
        newPhoto: 'https://a/new.jpg',
        replacedPhoto: 'https://a/old.jpg',
      },
    ]);
  });

  it('monta documento CHD com parts.items no POST', () => {
    const dto = {
      oficinaId: 'of-1',
      identification: {
        os: 'OS-2026-004',
        date: '2026-06-23',
        time: '22:39',
        brandModel: 'BR1',
        platePrefix: 'x',
        currentKm: '0',
        hourMeter: '0',
        driver: 'a',
        technicalResponsible: 'b',
        fuel: '1/2',
      },
      generalState: {},
      modules: {},
      parts: {
        items: [
          {
            description: 'PEÇA 02',
            partNumber: '4345',
            brand: 'Honda',
            oldPartDestination: 'Descarte ecológico',
            newPhoto: 'https://x/part-0-new.jpg',
          },
        ],
      },
      services: { items: [] },
      closing: {
        inventoryChecked: true,
        driverSignature: 'a',
        workshopSignature: 'b',
      },
    } as CreateChecklistDevolucaoDto;

    const doc = buildChecklistDevolucaoDoc(
      'uuid-chd',
      'CHD-2026-0001',
      dto,
      '2026-06-23T01:00:00.000Z',
    );

    expect(doc.parts.items).toHaveLength(1);
    expect(doc.parts.items[0]).toMatchObject({
      description: 'PEÇA 02',
      partNumber: '4345',
      brand: 'Honda',
      oldPartDestination: 'Descarte ecológico',
      newPhoto: 'https://x/part-0-new.jpg',
    });
  });

  it('monta documento CHD com status enviado', () => {
    const dto = {
      oficinaId: 'of-1',
      prefeituraId: 'pref-1',
      solicitacaoOsId: 'sol-1',
      ordemServicoId: 'ord-1',
      identification: {
        os: 'OS-2026-047',
        date: '2026-06-20',
        time: '16:40',
        brandModel: 'Sany SYL956H',
        platePrefix: 'ABC-1234',
        currentKm: '42330',
        hourMeter: '6890,2',
        driver: 'João',
        technicalResponsible: 'Carlos',
        fuel: '1/2',
      },
      generalState: { limpezaInterna: { status: 'ok' } },
      modules: { sistemaHidraulico: { status: 'ok' } },
      parts: { items: [] },
      services: {
        items: [
          {
            systemComponent: 'Hidráulico',
            initialDiagnosis: 'Vazamento',
            technicalAction: 'Troca retentor',
            technician: 'Pedro',
            manHours: '2.5',
          },
        ],
      },
      closing: {
        inventoryChecked: true,
        driverSignature: 'João',
        workshopSignature: 'Carlos',
      },
    } as CreateChecklistDevolucaoDto;

    const doc = buildChecklistDevolucaoDoc(
      'uuid-chd',
      'CHD-2026-0001',
      dto,
      '2026-06-20T16:40:00.000Z',
    );

    expect(doc.id).toBe('uuid-chd');
    expect(doc.number).toBe('CHD-2026-0001');
    expect(doc.identification.os).toBe('OS-2026-047');
    expect(doc.status).toBe('enviado');
    expect(doc.services.items).toHaveLength(1);
    expect(doc.closing.inventoryChecked).toBe(true);
  });
});
