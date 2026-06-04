import {
  crc16kermit,
  formatD,
  formatDH,
  linhaAssinatura,
  montarAFD,
  nomeArquivoAFD,
  padA,
  padN,
  registroCabecalho,
  registroMarcacao,
  registroTrailer,
  type EmpresaAFD,
  type FabricanteAFD,
} from './afd';

const empresa: EmpresaAFD = {
  razaoSocial: 'Transportes ABC Ltda.',
  documento: '11222333000181',
  caepf: '',
};
const fabricante: FabricanteAFD = {
  inpi: '12345678901234567',
  tipoDoc: '1',
  documento: '99888777000166',
  modelo: '',
};

describe('AFD — helpers', () => {
  it('padN: zero à esquerda e largura fixa', () => {
    expect(padN('2379', 9)).toBe('000002379');
    expect(padN('1.234', 4)).toBe('1234');
    expect(padN('123456', 4)).toBe('3456'); // mantém os à direita
  });

  it('padA: espaço à direita e largura fixa', () => {
    expect(padA('AB', 5)).toBe('AB   ');
    expect(padA('ABCDEF', 3)).toBe('ABC');
  });

  it('crc16kermit: vetor oficial 123456789 → 2189', () => {
    expect(crc16kermit('123456789')).toBe('2189');
  });

  it('formatD / formatDH no fuso de São Paulo', () => {
    // 13:05:30Z = 10:05 em São Paulo (-03:00); segundos fixos "00".
    expect(formatD('2026-05-25T13:05:30.000Z')).toBe('2026-05-25');
    const dh = formatDH('2026-05-25T13:05:30.000Z');
    expect(dh).toBe('2026-05-25T10:05:00-0300');
    expect(dh).toHaveLength(24);
  });
});

describe('AFD — registros', () => {
  it('cabeçalho tem 302 caracteres', () => {
    const linha = registroCabecalho({
      empresa,
      fabricante,
      dataInicialIso: '2026-05-01T12:00:00Z',
      dataFinalIso: '2026-05-31T12:00:00Z',
      dataGeracaoIso: '2026-06-04T12:00:00Z',
    });
    expect(linha).toHaveLength(302);
  });

  it('marcação (tipo 7) tem 137 caracteres e encadeia o hash', () => {
    const a = registroMarcacao(
      {
        nsr: 1,
        timestampOriginal: '2026-05-25T11:00:00Z',
        cpf: '12345678901',
        createdAt: '2026-05-25T11:00:05Z',
      },
      '',
    );
    expect(a.linha).toHaveLength(137);
    expect(a.hash).toMatch(/^[0-9A-F]{64}$/);
    // O mesmo registro com hash anterior diferente gera hash diferente.
    const b = registroMarcacao(
      {
        nsr: 1,
        timestampOriginal: '2026-05-25T11:00:00Z',
        cpf: '12345678901',
        createdAt: '2026-05-25T11:00:05Z',
      },
      a.hash,
    );
    expect(b.hash).not.toBe(a.hash);
  });

  it('trailer tem 64 caracteres e conta o tipo 7', () => {
    const t = registroTrailer(42);
    expect(t).toHaveLength(64);
    expect(t.slice(0, 9)).toBe('999999999');
    expect(t.slice(54, 63)).toBe('000000042');
    expect(t.slice(63)).toBe('9');
  });

  it('assinatura tem 100 caracteres', () => {
    const s = linhaAssinatura();
    expect(s).toHaveLength(100);
    expect(s.startsWith('ASSINATURA_DIGITAL_EM_ARQUIVO_P7S')).toBe(true);
  });

  it('nome do arquivo segue o padrão REP-P', () => {
    expect(nomeArquivoAFD('12345678901234567', '11222333000181')).toBe(
      'AFD1234567890123456711222333000181REP_P.txt',
    );
  });
});

describe('AFD — montagem completa', () => {
  it('ordena por NSR, encadeia hash, conta e detecta CPF ausente', () => {
    const r = montarAFD({
      empresa,
      fabricante,
      dataGeracaoIso: '2026-06-04T12:00:00Z',
      marcacoes: [
        {
          nsr: 2,
          timestampOriginal: '2026-05-25T18:00:00Z',
          cpf: null, // sem CPF
          createdAt: '2026-05-25T18:00:00Z',
        },
        {
          nsr: 1,
          timestampOriginal: '2026-05-25T11:00:00Z',
          cpf: '12345678901',
          createdAt: '2026-05-25T11:00:00Z',
        },
      ],
    });

    // header, m(nsr1), m(nsr2), trailer, assinatura, + linha vazia final.
    const linhas = r.conteudo.split('\r\n');
    expect(linhas[0][9]).toBe('1'); // tipo do cabeçalho
    expect(linhas[1].slice(0, 9)).toBe('000000001'); // primeira marcação = NSR 1
    expect(linhas[2].slice(0, 9)).toBe('000000002');
    expect(linhas[3].slice(0, 9)).toBe('999999999'); // trailer
    expect(linhas[5]).toBe(''); // CRLF ao final da última linha
    expect(r.totalMarcacoes).toBe(2);
    expect(r.semCpf).toBe(1);
    expect(r.nome).toContain('REP_P.txt');
  });
});
