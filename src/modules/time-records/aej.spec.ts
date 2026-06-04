import {
  linhaAej,
  montarAEJ,
  registroCabecalho,
  registroMarcacao,
  type EmpresaAEJ,
  type LedgerAEJ,
  type PtrpAEJ,
} from './aej';

const empresa: EmpresaAEJ = {
  razaoSocial: 'Transportes ABC Ltda.',
  documento: '11222333000181',
  caepf: '',
};
const ptrp: PtrpAEJ = {
  nome: 'Hora Útil 360',
  versao: '1.0',
  tpIdtDesenv: '1',
  documento: '99888777000166',
  razaoNome: 'Hora Útil 360',
  email: 'dev@horautil.com',
};

function orig(over: Partial<LedgerAEJ>): LedgerAEJ {
  return {
    id: 'o1',
    registro: 'original',
    nsr: 1,
    tipo: 'entrada',
    timestampOriginal: '2026-05-25T11:00:00Z',
    cpf: '12345678901',
    name: 'João',
    ...over,
  };
}

describe('AEJ — helpers', () => {
  it('linhaAej junta por pipe e sanitiza pipe/quebras', () => {
    expect(linhaAej(['a', 'b', 'c'])).toBe('a|b|c');
    expect(linhaAej(['x|y', 'z\nw'])).toBe('x y|z w');
  });

  it('cabeçalho começa com 01 e tem versão 001', () => {
    const l = registroCabecalho(
      empresa,
      '2026-05-01T12:00:00Z',
      '2026-05-31T12:00:00Z',
      '2026-06-04T12:00:00Z',
    ).split('|');
    expect(l[0]).toBe('01');
    expect(l[1]).toBe('1'); // CNPJ
    expect(l[2]).toBe('11222333000181');
    expect(l[l.length - 1]).toBe('001');
  });

  it('marcação tipo 05 monta os campos na ordem certa', () => {
    const l = registroMarcacao({
      idtVinculo: 1,
      dataHoraMarc: '2026-05-25T11:00:00Z',
      tpMarc: 'E',
      seqEntSaida: 1,
      fonteMarc: 'O',
      codHorContratual: 'PADRAO',
    }).split('|');
    expect(l[0]).toBe('05');
    expect(l[1]).toBe('1');
    expect(l[3]).toBe('1'); // idRepAej
    expect(l[4]).toBe('E');
    expect(l[6]).toBe('O');
    expect(l[7]).toBe('PADRAO');
  });
});

describe('AEJ — montagem (trilha tratada O/I/D)', () => {
  const base = {
    empresa,
    inpi: '12345678901234567',
    ptrp,
    horario: null,
    dataGeracaoIso: '2026-06-04T12:00:00Z',
  };

  it('marcação original sem tratamento → fonte O', () => {
    const r = montarAEJ({ ...base, registros: [orig({})] });
    const m = r.conteudo.split('\r\n').find((l) => l.startsWith('05'))!.split('|');
    expect(m[4]).toBe('E'); // tpMarc
    expect(m[6]).toBe('O'); // fonteMarc
    expect(r.totalMarcacoes).toBe(1);
  });

  it('correção aplicada → original vira D + correção I', () => {
    const r = montarAEJ({
      ...base,
      registros: [
        orig({ nsr: 1 }),
        {
          id: 'a1',
          registro: 'ajuste',
          nsr: 2,
          refNsr: 1,
          tipo: 'entrada',
          timestampOriginal: '2026-05-25T11:05:00Z',
          cpf: '12345678901',
          name: 'João',
          aplicado: true,
          motivo: 'Cheguei 11:05',
        },
      ],
    });
    const marc = r.conteudo
      .split('\r\n')
      .filter((l) => l.startsWith('05'))
      .map((l) => l.split('|'));
    expect(marc).toHaveLength(2);
    expect(marc.some((m) => m[4] === 'D')).toBe(true); // original desconsiderada
    expect(marc.some((m) => m[6] === 'I')).toBe(true); // correção incluída
  });

  it('cancelamento aplicado → original vira D', () => {
    const r = montarAEJ({
      ...base,
      registros: [
        orig({ nsr: 1 }),
        {
          id: 'c1',
          registro: 'cancelamento',
          nsr: 2,
          refNsr: 1,
          tipo: 'entrada',
          timestampOriginal: '2026-05-25T11:00:00Z',
          cpf: '12345678901',
          name: 'João',
          aplicado: true,
        },
      ],
    });
    const m = r.conteudo.split('\r\n').find((l) => l.startsWith('05'))!.split('|');
    expect(m[4]).toBe('D');
  });

  it('marcação sem CPF é pulada e contada', () => {
    const r = montarAEJ({ ...base, registros: [orig({ cpf: null })] });
    expect(r.totalMarcacoes).toBe(0);
    expect(r.semCpf).toBe(1);
  });

  it('cria um vínculo (03) por CPF e o trailer conta certo', () => {
    const r = montarAEJ({
      ...base,
      registros: [
        orig({ id: 'a', nsr: 1, cpf: '11111111111', name: 'A' }),
        orig({ id: 'b', nsr: 2, cpf: '22222222222', name: 'B', tipo: 'saida' }),
      ],
    });
    const linhas = r.conteudo.split('\r\n');
    expect(linhas.filter((l) => l.startsWith('03'))).toHaveLength(2);
    const trailer = linhas.find((l) => l.startsWith('99'))!.split('|');
    // 99|t01|t02|t03|t04|t05|t06|t07|t08
    expect(trailer[3]).toBe('2'); // qt tipo 03 (vínculos)
    expect(trailer[5]).toBe('2'); // qt tipo 05 (marcações)
    expect(r.nome.startsWith('AEJ')).toBe(true);
  });
});
