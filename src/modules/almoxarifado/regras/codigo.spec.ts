import { normalizarCodigo, proximoCodigoInterno } from './codigo';

describe('proximoCodigoInterno', () => {
  it('a primeira peça da empresa é ALM-000001', () => {
    expect(proximoCodigoInterno(null)).toBe('ALM-000001');
  });

  it('incrementa preservando os seis dígitos', () => {
    expect(proximoCodigoInterno('ALM-000123')).toBe('ALM-000124');
  });

  it('atravessa a casa decimal sem perder zero à esquerda', () => {
    expect(proximoCodigoInterno('ALM-000999')).toBe('ALM-001000');
  });

  it('passa de seis dígitos sem truncar', () => {
    // Truncar aqui geraria código repetido e o unique derrubaria o cadastro.
    expect(proximoCodigoInterno('ALM-999999')).toBe('ALM-1000000');
  });

  it('código fora do padrão não trava o cadastro: recomeça do um', () => {
    // Cadastro importado de planilha traz qualquer coisa. Falhar aqui
    // impediria cadastrar peça nova numa empresa migrada.
    expect(proximoCodigoInterno('filtro-antigo-7')).toBe('ALM-000001');
  });
});

describe('normalizarCodigo', () => {
  it('tira espaço e caixa — leitor de balcão manda com Enter e espaços', () => {
    expect(normalizarCodigo('  alm-000123 \n')).toBe('ALM-000123');
  });

  it('preserva a barra de part number do fabricante', () => {
    expect(normalizarCodigo(' 32/925994 ')).toBe('32/925994');
  });

  it('string vazia vira vazia, não lança', () => {
    expect(normalizarCodigo('   ')).toBe('');
  });
});
