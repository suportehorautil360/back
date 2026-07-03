import {
  calcularChecklistsPorSemana,
  calcularTopOperadores,
  filtrarChecklistsPorMes,
} from './top-operadores.helper';
import type { ChecklistRegistroDoc } from '../checklists-registros.types';

function registro(
  partial: Partial<ChecklistRegistroDoc>,
): ChecklistRegistroDoc {
  return {
    id: partial.id ?? '1',
    dataHoraIso: partial.dataHoraIso ?? '',
    operador: partial.operador ?? '',
    chassis: '',
    categoria: '',
    modelo: '',
    linha: '',
    totalItens: 0,
    totalSim: 0,
    pontuacao: 0,
    horimetro: '',
    assinaturaOperador: '',
    respostas: {},
    obs: null,
    localizacaoGps: null,
    prefeituraId: 'pref-1',
    idOperadorSession: '',
    itensNao: [],
  };
}

describe('top-operadores.helper', () => {
  it('filtra por mês', () => {
    const lista = [
      registro({ dataHoraIso: '2026-06-10T10:00:00', operador: 'Ana' }),
      registro({ dataHoraIso: '2026-07-02T10:00:00', operador: 'Bruno' }),
    ];

    expect(filtrarChecklistsPorMes(lista, '2026-07')).toHaveLength(1);
  });

  it('calcula top operadores', () => {
    const lista = [
      registro({ operador: 'Ana' }),
      registro({ operador: 'Ana' }),
      registro({ operador: 'Bruno' }),
    ];

    expect(calcularTopOperadores(lista)).toEqual([
      { nome: 'Ana', total: 2 },
      { nome: 'Bruno', total: 1 },
    ]);
  });

  it('agrupa checklists por semana do mês', () => {
    const lista = [
      registro({ dataHoraIso: '2026-07-03T10:00:00' }),
      registro({ dataHoraIso: '2026-07-12T10:00:00' }),
      registro({ dataHoraIso: '2026-07-25T10:00:00' }),
    ];

    expect(calcularChecklistsPorSemana(lista)).toEqual([1, 1, 0, 1]);
  });
});
