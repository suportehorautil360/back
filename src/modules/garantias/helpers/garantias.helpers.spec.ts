import {
  calcularStatusGarantia,
  formatDataBr,
} from './calcular-status-garantia.helper';
import { parseHorimetro } from './parse-horimetro.helper';
import { gerarGarantiasDeChecklistDevolucao } from './gerar-garantias-de-chd.helper';
import type { ChecklistDevolucaoDoc } from '../../checklist-devolucao/checklist-devolucao.types';

describe('parseHorimetro', () => {
  it('parseia formatos brasileiros', () => {
    expect(parseHorimetro('6890,2')).toBe(6890.2);
    expect(parseHorimetro('6.890,2 h')).toBe(6890.2);
    expect(parseHorimetro('42330')).toBe(42330);
  });
});

describe('calcularStatusGarantia', () => {
  it('marca vencido após data', () => {
    expect(
      calcularStatusGarantia({
        venceEmIso: '2020-01-01',
        limiteHorimetro: 9000,
        horimetroAtual: 8000,
        agora: new Date('2026-01-01'),
      }),
    ).toBe('vencido');
  });

  it('marca vencendo perto do limite de horímetro', () => {
    expect(
      calcularStatusGarantia({
        venceEmIso: '2030-01-01',
        limiteHorimetro: 7390,
        horimetroAtual: 7350,
        agora: new Date('2026-06-01'),
      }),
    ).toBe('vencendo');
  });
});

describe('gerarGarantiasDeChecklistDevolucao', () => {
  const chd = {
    id: 'chd-1',
    number: 'CHD-2026-0001',
    oficinaId: 'of-1',
    parceiroId: null,
    prefeituraId: 'pref-1',
    solicitacaoOsId: 'sol-1',
    ordemServicoId: 'ord-1',
    identification: {
      os: 'OS-2026-047',
      date: '2026-06-20',
      time: '16:40',
      brandModel: 'Sany',
      platePrefix: 'ABC',
      currentKm: '0',
      hourMeter: '6890,2',
      driver: 'João',
      technicalResponsible: 'Carlos',
      fuel: '1/2',
    },
    generalState: {},
    modules: {},
    parts: {
      items: [
        {
          description: 'Retentor',
          partNumber: '9920034',
          brand: 'Komatsu',
          oldPartDestination: 'Descarte ecológico' as const,
        },
      ],
    },
    services: {
      items: [
        {
          systemComponent: 'Hidráulico',
          initialDiagnosis: 'Vazamento',
          technicalAction: 'Troca',
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
    status: 'enviado' as const,
    createdAt: '2026-06-20T16:40:00.000Z',
  } satisfies ChecklistDevolucaoDoc;

  it('gera peça e serviço', () => {
    const rows = gerarGarantiasDeChecklistDevolucao(chd, {
      prefeituraId: 'pref-1',
      equipamentoId: 'eq-1',
      equipamento: 'Sany SYL956H',
      fornecedor: 'Oficina XYZ',
    });

    expect(rows).toHaveLength(2);
    expect(rows[0].tipo).toBe('peca');
    expect(rows[1].tipo).toBe('servico');
    expect(rows[0].limiteHorimetro).toBe(6890.2 + 500);
    expect(formatDataBr(rows[0].venceEm)).toMatch(/20\/09\/2026/);
  });
});
