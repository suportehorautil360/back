import {
  INTERVALO_MINIMO_ABASTECIMENTO_MS,
  mensagemIntervaloAbastecimento,
  ultimoAbastecimentoTimestampMs,
  verificarIntervaloAbastecimento,
} from './intervalo-abastecimento.helper';

describe('intervalo-abastecimento.helper', () => {
  it('libera quando não há abastecimento anterior', () => {
    expect(verificarIntervaloAbastecimento(null).liberado).toBe(true);
  });

  it('bloqueia até 3h após o último abastecimento', () => {
    const ultimo = Date.parse('2026-06-26T19:08:00.000Z');
    const as21 = Date.parse('2026-06-26T21:00:00.000Z');
    const as22 = Date.parse('2026-06-26T22:08:00.000Z');

    expect(verificarIntervaloAbastecimento(ultimo, as21).liberado).toBe(false);
    expect(verificarIntervaloAbastecimento(ultimo, as22).liberado).toBe(true);
    expect(verificarIntervaloAbastecimento(ultimo, as21).proximoEmMs).toBe(
      ultimo + INTERVALO_MINIMO_ABASTECIMENTO_MS,
    );
  });

  it('pega o createdAt mais recente do equipamento na prefeitura', () => {
    const docs = [
      {
        prefeituraId: 'p1',
        equipmentId: 'eq1',
        createdAt: '2026-06-26T10:00:00.000Z',
      },
      {
        prefeituraId: 'p1',
        equipmentId: 'eq1',
        createdAt: '2026-06-26T19:08:00.000Z',
      },
      {
        prefeituraId: 'p1',
        equipmentId: 'eq2',
        createdAt: '2026-06-26T23:00:00.000Z',
      },
      {
        prefeituraId: 'p2',
        equipmentId: 'eq1',
        createdAt: '2026-06-26T23:00:00.000Z',
      },
    ];
    expect(ultimoAbastecimentoTimestampMs(docs, 'p1', 'eq1')).toBe(
      Date.parse('2026-06-26T19:08:00.000Z'),
    );
  });

  it('monta mensagem com horário do próximo abastecimento', () => {
    const proximo = Date.parse('2026-06-26T22:08:00.000Z');
    expect(mensagemIntervaloAbastecimento(proximo)).toMatch(
      /Próximo permitido às \d{2}:\d{2}/,
    );
  });
});
