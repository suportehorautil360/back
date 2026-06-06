import { mapAbastecimento } from './abastecimentos.mapper';

describe('abastecimentos/mapAbastecimento', () => {
  it('mapeia um registro de Posto (km + R$ + posto)', () => {
    const r = mapAbastecimento({
      id: 'a1',
      data: '2026-06-02',
      hora: '08:15',
      veiculo: 'Hilux Cabine Dupla',
      placa: 'JKL-7B43',
      tipo: 'Carro',
      combustivel: 'Diesel S10',
      litros: 50,
      valorTotal: 'R$ 306,00',
      km: 85260,
      postoNome: 'Posto Trevo BR-153',
    });
    expect(r.origem).toBe('posto');
    expect(r.leitura).toBe(85260);
    expect(r.leituraUnidade).toBe('km');
    expect(r.valor).toBe(306);
    expect(r.local).toBe('Posto Trevo BR-153');
    expect(r.tipoVeiculo).toBe('Carro');
    expect(r.km).toBe(85260);
  });

  it('mapeia um registro de Comboio (horas, sem valor)', () => {
    const r = mapAbastecimento({
      id: 'c1',
      data: '2026-06-02',
      origem: 'comboio',
      veiculo: 'Escavadeira CAT 320',
      placa: 'ABC-1234',
      tipo: 'Máquina',
      litros: 320,
      leitura: 4690,
      leituraUnidade: 'h',
      local: 'Talhão Norte',
    });
    expect(r.origem).toBe('comboio');
    expect(r.leituraUnidade).toBe('h');
    expect(r.leitura).toBe(4690);
    expect(r.valor).toBe(0); // comboio não tem valor
    expect(r.local).toBe('Talhão Norte');
    expect(r.km).toBe(0); // km só quando a unidade é km
  });

  it('campos ausentes viram defaults seguros', () => {
    const r = mapAbastecimento({ id: 'x' });
    expect(r.origem).toBe('posto');
    expect(r.litros).toBe(0);
    expect(r.valor).toBe(0);
    expect(r.leitura).toBe(0);
    expect(r.veiculo).toBe('');
    expect(r.combustivel).toBe('—');
  });
});
