import { haSobreposicao, intervaloInvalido } from './apontamento';

const d = (hhmm: string) => new Date(`2026-09-08T${hhmm}:00-03:00`);

describe('intervaloInvalido', () => {
  it('aceita fim depois do início', () => {
    expect(intervaloInvalido(d('08:00'), d('11:30'))).toBe(false);
  });

  it('aceita apontamento aberto', () => {
    expect(intervaloInvalido(d('08:00'), null)).toBe(false);
  });

  it('recusa fim antes do início', () => {
    expect(intervaloInvalido(d('11:30'), d('08:00'))).toBe(true);
  });

  it('recusa fim igual ao início — intervalo de duração zero', () => {
    expect(intervaloInvalido(d('08:00'), d('08:00'))).toBe(true);
  });
});

describe('haSobreposicao', () => {
  const existentes = [
    { id: 'a', inicio: d('08:00'), fim: d('10:00') },
    { id: 'b', inicio: d('13:00'), fim: d('15:00') },
  ];

  it('aceita intervalo que cabe no buraco', () => {
    expect(
      haSobreposicao({ inicio: d('10:30'), fim: d('12:00') }, existentes),
    ).toBe(false);
  });

  it('aceita encostar no fim do anterior', () => {
    expect(
      haSobreposicao({ inicio: d('10:00'), fim: d('12:00') }, existentes),
    ).toBe(false);
  });

  it('recusa começar dentro de um existente', () => {
    expect(
      haSobreposicao({ inicio: d('09:00'), fim: d('11:00') }, existentes),
    ).toBe(true);
  });

  it('recusa terminar dentro de um existente', () => {
    expect(
      haSobreposicao({ inicio: d('07:00'), fim: d('09:00') }, existentes),
    ).toBe(true);
  });

  it('recusa engolir um existente inteiro', () => {
    expect(
      haSobreposicao({ inicio: d('07:00'), fim: d('16:00') }, existentes),
    ).toBe(true);
  });

  it('ignora o próprio registro ao editar', () => {
    expect(
      haSobreposicao(
        { id: 'a', inicio: d('08:30'), fim: d('10:30') },
        existentes,
      ),
    ).toBe(false);
  });

  // Aberto sem fim se estende até agora: qualquer coisa depois dele colide.
  it('recusa quando existe um aberto anterior', () => {
    expect(
      haSobreposicao({ inicio: d('11:00'), fim: d('12:00') }, [
        { id: 'c', inicio: d('09:00'), fim: null },
      ]),
    ).toBe(true);
  });

  it('recusa quando o NOVO é aberto e alcança um existente posterior', () => {
    expect(
      haSobreposicao({ inicio: d('12:00'), fim: null }, existentes),
    ).toBe(true);
  });
});
