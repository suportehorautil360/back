import {

  enrichSolicitacoesWithEquipamento,

  extractEquipamentoChassis,

  extractEquipamentoMedicao,

  parseHorimetroMedicaoFields,

} from './enrich-solicitacoes-equipamento.helper';

import type { SolicitacaoOsListItem } from '../os.types';



function baseItem(

  overrides: Partial<SolicitacaoOsListItem> = {},

): SolicitacaoOsListItem {

  return {

    id: 'sol-1',

    protocol: 'OS-2026-001',

    equipment: 'Retro CAT',

    line: 'Amarela',

    operator: 'João',

    report: 'Defeito',

    workshops: [],

    workshopIds: [],

    status: 'aguardando_orcamento',

    statusLabel: 'Aguardando orçamento',

    serviceType: 'corrective',

    serviceTypeLabel: 'Corretiva',

    dateLabel: '01/01/2026',

    createdAt: '2026-01-01T00:00:00.000Z',

    protocolo: 'OS-2026-001',

    equipamento: 'Retro CAT',

    linha: 'Amarela',

    operador: 'João',

    relato: 'Defeito',

    oficinas: [],

    oficinasIds: [],

    oficinasResponderam: [],

    lances: [],

    valorOrcado: null,

    criadoEm: null,

    equipmentId: 'eq-1',

    equipamentoId: 'eq-1',

    chassis: '',

    chassi: '',

    horimetro: '',

    hourMeter: '',

    currentKm: '',

    km: '',

    medicaoAtual: null,

    unidadeRevisao: '',

    ...overrides,

  };

}



describe('enrich-solicitacoes-equipamento.helper', () => {

  it('extrai chassis do equipamento', () => {

    expect(

      extractEquipamentoChassis({ chassis: 'ABC-1234', chassi: 'XYZ' }),

    ).toBe('ABC-1234');

  });



  it('extrai horimetro em horas do equipamento', () => {

    expect(

      extractEquipamentoMedicao({

        medicaoAtual: 6890.2,

        unidadeRevisao: 'h',

      }),

    ).toMatchObject({

      horimetro: '6.890,2 h',

      hourMeter: '6890,2',

      currentKm: '',

      unidadeRevisao: 'h',

      medicaoAtual: 6890.2,

    });

  });



  it('extrai km do equipamento', () => {

    expect(

      extractEquipamentoMedicao({

        medicaoAtual: 12500,

        unidadeRevisao: 'km',

      }),

    ).toMatchObject({

      horimetro: '12.500 km',

      currentKm: '12500',

      km: '12500',

      hourMeter: '',

      unidadeRevisao: 'km',

      medicaoAtual: 12500,

    });

  });



  it('interpreta snapshot de horimetro da solicitacao', () => {

    expect(parseHorimetroMedicaoFields('1.250 h')).toMatchObject({

      hourMeter: '1.250',

      unidadeRevisao: 'h',

    });

    expect(parseHorimetroMedicaoFields('12.500 km')).toMatchObject({

      currentKm: '12.500',

      km: '12.500',

      unidadeRevisao: 'km',

    });

  });



  it('preenche chassis e medicao nas solicitações da oficina', () => {

    const map = new Map<string, Record<string, unknown>>([

      [

        'eq-1',

        {

          id: 'eq-1',

          chassis: 'JIDFNF089',

          medicaoAtual: 3200,

          unidadeRevisao: 'h',

        },

      ],

    ]);



    const [item] = enrichSolicitacoesWithEquipamento([baseItem()], map);



    expect(item.chassis).toBe('JIDFNF089');

    expect(item.chassi).toBe('JIDFNF089');

    expect(item.horimetro).toBe('3.200 h');

    expect(item.hourMeter).toBe('3200');

    expect(item.unidadeRevisao).toBe('h');

  });



  it('preenche medicao mesmo sem chassis', () => {

    const map = new Map<string, Record<string, unknown>>([

      ['eq-1', { id: 'eq-1', medicaoAtual: 45000, unidadeRevisao: 'km' }],

    ]);



    const [item] = enrichSolicitacoesWithEquipamento([baseItem()], map);



    expect(item.chassis).toBe('');

    expect(item.currentKm).toBe('45000');

    expect(item.km).toBe('45000');

    expect(item.horimetro).toBe('45.000 km');

  });

});


