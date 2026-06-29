import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { ConsumoCustoController } from '../src/modules/movimentacoes/consumo-custo/consumo-custo.controller';
import { ConsumoCustoService } from '../src/modules/movimentacoes/consumo-custo/consumo-custo.service';

describe('ConsumoCustoController (e2e)', () => {
  let app: INestApplication<App>;

  const listarPorPrefeitura = jest.fn();

  beforeAll(async () => {
    listarPorPrefeitura.mockResolvedValue({
      data: {
        titulo: 'Consumo & Custo por Veículo',
        periodo: {
          label: '01/06/2026 — 30/06/2026',
          startDate: '2026-06-01',
          endDate: '2026-06-30',
        },
        calculo: {
          titulo: 'Como o consumo e o custo são calculados',
          formulaConsumo:
            'Consumo = litros do abastecimento ÷ (leitura atual − leitura anterior)',
          formulaCusto:
            'Quando há preço por litro, o gasto = litros × preço/l e o custo unitário = consumo médio × preço/l.',
          observacao: 'Válido para carros, caminhões e máquinas pesadas.',
        },
        veiculos: [
          {
            equipmentId: 'eq-1',
            nome: 'Frota Teste',
            consumoMedio: { valor: 0.15, valorExibicao: '0,15 L/km' },
            custoMedio: { valor: 0.8985, valorExibicao: 'R$ 0,90/km' },
            totais: { gasto: 269.55, litros: 45 },
          },
        ],
      },
      message: 'Consumo e custo buscados com sucesso!',
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [ConsumoCustoController],
      providers: [
        {
          provide: ConsumoCustoService,
          useValue: { listarPorPrefeitura },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    listarPorPrefeitura.mockClear();
    listarPorPrefeitura.mockResolvedValue({
      data: {
        titulo: 'Consumo & Custo por Veículo',
        periodo: {
          label: '01/06/2026 — 30/06/2026',
          startDate: '2026-06-01',
          endDate: '2026-06-30',
        },
        calculo: {
          titulo: 'Como o consumo e o custo são calculados',
          formulaConsumo:
            'Consumo = litros do abastecimento ÷ (leitura atual − leitura anterior)',
          formulaCusto:
            'Quando há preço por litro, o gasto = litros × preço/l e o custo unitário = consumo médio × preço/l.',
          observacao: 'Válido para carros, caminhões e máquinas pesadas.',
        },
        veiculos: [
          {
            equipmentId: 'eq-1',
            nome: 'Frota Teste',
            consumoMedio: { valor: 0.15, valorExibicao: '0,15 L/km' },
            custoMedio: { valor: 0.8985, valorExibicao: 'R$ 0,90/km' },
            totais: { gasto: 269.55, litros: 45 },
          },
        ],
      },
      message: 'Consumo e custo buscados com sucesso!',
    });
  });

  it('GET /movimentacoes/consumo-custo/:prefeituraId repassa período e devolve payload', async () => {
    const res = await request(app.getHttpServer())
      .get(
        '/movimentacoes/consumo-custo/pref-1?startDate=2026-06-01&endDate=2026-06-30',
      )
      .expect(200);

    expect(listarPorPrefeitura).toHaveBeenCalledWith(
      'pref-1',
      '2026-06-01',
      '2026-06-30',
    );
    expect(res.body.data.veiculos[0].consumoMedio.valor).toBeCloseTo(0.15, 4);
    expect(res.body.message).toMatch(/sucesso/i);
  });
});
