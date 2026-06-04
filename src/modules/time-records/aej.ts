/**
 * Geração do AEJ (Arquivo Eletrônico de Jornada) — Portaria MTE 671/2021,
 * Anexo VI. Arquivo **tratado** (complementar ao AFD), gerado pelo PTRP.
 *
 * Diferente do AFD: campos **delimitados por `|`** (tamanho variável), sem CRC/
 * hash por registro. Texto ISO-8859-1, 1 registro por linha em CRLF, sem linhas
 * em branco. Reusa formatD/formatDH/linhaAssinatura do AFD.
 */
import { formatD, formatDH, linhaAssinatura } from './afd';

const VERSAO_AEJ = '001';

/** Sanitiza um campo: remove `|`, CR e LF (que quebrariam o delimitador). */
function campo(v: string | number | null | undefined): string {
  return String(v ?? '').replace(/[\r\n|]+/g, ' ');
}

function digitos(v: string | number | null | undefined): string {
  return String(v ?? '').replace(/\D/g, '');
}

/** Hora "HH:MM" → "hhmm" (campo tipo H). Vazio se não informado. */
function hhmm(hm: string): string {
  const d = digitos(hm);
  return d ? d.slice(0, 4).padStart(4, '0') : '';
}

/** Junta os campos com `|` (sem pipe ao final). */
export function linhaAej(campos: (string | number | null | undefined)[]): string {
  return campos.map(campo).join('|');
}

export interface EmpresaAEJ {
  razaoSocial: string;
  documento: string; // CNPJ(14) ou CPF(11), só dígitos
  caepf?: string;
  cno?: string;
}

export interface PtrpAEJ {
  nome: string;
  versao: string;
  tpIdtDesenv: '1' | '2';
  documento: string;
  razaoNome: string;
  email: string;
}

export interface HorarioAEJ {
  codigo: string;
  durJornadaMin: number;
  entrada1: string; // "HH:MM"
  saida1: string;
  entrada2?: string;
  saida2?: string;
}

export interface VinculoAEJ {
  idt: number;
  cpf: string;
  nome: string;
}

export interface MarcacaoAEJ {
  idtVinculo: number;
  dataHoraMarc: string; // ISO
  tpMarc: 'E' | 'S' | 'D';
  seqEntSaida: number;
  fonteMarc: 'O' | 'I';
  codHorContratual?: string;
  motivo?: string;
}

/** Registro cru do ledger usado para montar o AEJ. */
export interface LedgerAEJ {
  id: string;
  registro: 'original' | 'ajuste' | 'cancelamento';
  nsr?: number;
  refNsr?: number | null;
  refId?: string;
  tipo: string; // entrada|almoco|volta|saida
  timestampOriginal: string;
  cpf?: string | null;
  name: string;
  aplicado?: boolean;
  motivo?: string | null;
}

// --- Construtores de registro ---------------------------------------------

export function registroCabecalho(
  empresa: EmpresaAEJ,
  dataInicialIso: string,
  dataFinalIso: string,
  dataGeracaoIso: string,
): string {
  const doc = digitos(empresa.documento);
  const tpId = doc.length === 11 ? '2' : '1';
  return linhaAej([
    '01',
    tpId,
    doc,
    digitos(empresa.caepf),
    digitos(empresa.cno),
    empresa.razaoSocial,
    formatD(dataInicialIso),
    formatD(dataFinalIso),
    formatDH(dataGeracaoIso),
    VERSAO_AEJ,
  ]);
}

/** Registro tipo 02 — REP-P utilizado (idRepAej fixo "1", tpRep "3"). */
export function registroRep(inpi: string): string {
  return linhaAej(['02', '1', '3', digitos(inpi)]);
}

export function registroVinculo(v: VinculoAEJ): string {
  return linhaAej(['03', v.idt, digitos(v.cpf), v.nome]);
}

export function registroHorario(h: HorarioAEJ): string {
  return linhaAej([
    '04',
    h.codigo,
    h.durJornadaMin,
    hhmm(h.entrada1),
    hhmm(h.saida1),
    hhmm(h.entrada2 ?? ''),
    hhmm(h.saida2 ?? ''),
  ]);
}

export function registroMarcacao(m: MarcacaoAEJ): string {
  return linhaAej([
    '05',
    m.idtVinculo,
    formatDH(m.dataHoraMarc),
    '1', // idRepAej
    m.tpMarc,
    m.seqEntSaida,
    m.fonteMarc,
    m.codHorContratual ?? '',
    m.motivo ?? '',
  ]);
}

export function registroPtrp(p: PtrpAEJ): string {
  return linhaAej([
    '08',
    p.nome,
    p.versao,
    p.tpIdtDesenv,
    digitos(p.documento),
    p.razaoNome,
    p.email,
  ]);
}

export function registroTrailer(c: {
  t01: number;
  t02: number;
  t03: number;
  t04: number;
  t05: number;
  t06: number;
  t07: number;
  t08: number;
}): string {
  return linhaAej(['99', c.t01, c.t02, c.t03, c.t04, c.t05, c.t06, c.t07, c.t08]);
}

/** Nome do arquivo AEJ: "AEJ" + INPI + doc empregador. */
export function nomeArquivoAEJ(inpi: string, docEmpregador: string): string {
  return `AEJ${digitos(inpi)}${digitos(docEmpregador)}.txt`;
}

// --- Montagem --------------------------------------------------------------

const COD_HORARIO = 'PADRAO';

function mapTipo(tipo: string): { tpMarc: 'E' | 'S'; seq: number } {
  switch (tipo) {
    case 'almoco':
      return { tpMarc: 'S', seq: 1 };
    case 'volta':
      return { tpMarc: 'E', seq: 2 };
    case 'saida':
      return { tpMarc: 'S', seq: 2 };
    case 'entrada':
    default:
      return { tpMarc: 'E', seq: 1 };
  }
}

function mira(ref: LedgerAEJ, orig: LedgerAEJ): boolean {
  if (ref.refNsr != null && orig.nsr != null) return ref.refNsr === orig.nsr;
  if (ref.refId) return ref.refId === orig.id;
  return false;
}

export interface ResultadoAEJ {
  conteudo: string;
  nome: string;
  totalMarcacoes: number;
  semCpf: number;
  assinado: boolean;
  assinaturaP7sBase64?: string;
}

export function montarAEJ(opts: {
  empresa: EmpresaAEJ;
  inpi: string;
  ptrp: PtrpAEJ;
  horario: HorarioAEJ | null;
  registros: LedgerAEJ[];
  dataGeracaoIso: string;
}): ResultadoAEJ {
  const originais = opts.registros.filter(
    (r) => (r.registro ?? 'original') === 'original',
  );
  const correcoes = opts.registros.filter(
    (r) => r.registro === 'ajuste' && r.aplicado === true && (r.refNsr != null || r.refId),
  );
  const inclusoes = opts.registros.filter(
    (r) => r.registro === 'ajuste' && r.aplicado === true && r.refNsr == null && !r.refId,
  );
  const cancelamentos = opts.registros.filter(
    (r) => r.registro === 'cancelamento' && r.aplicado !== false,
  );

  // Vínculos: um por CPF distinto (entre marcações que viram tipo 05).
  const vinculoPorCpf = new Map<string, VinculoAEJ>();
  const idtDe = (cpf: string, nome: string): number => {
    const c = digitos(cpf);
    if (!vinculoPorCpf.has(c)) {
      vinculoPorCpf.set(c, { idt: vinculoPorCpf.size + 1, cpf: c, nome });
    }
    return vinculoPorCpf.get(c)!.idt;
  };

  const marcacoes: MarcacaoAEJ[] = [];
  let semCpf = 0;

  const emitir = (
    reg: LedgerAEJ,
    fonte: 'O' | 'I',
    desconsiderar: boolean,
    motivo?: string,
  ) => {
    const cpf = digitos(reg.cpf);
    if (!cpf) {
      semCpf++;
      return;
    }
    const idt = idtDe(cpf, reg.name);
    const { tpMarc, seq } = mapTipo(reg.tipo);
    const ehPrimEntrada = tpMarc === 'E' && seq === 1;
    marcacoes.push({
      idtVinculo: idt,
      dataHoraMarc: reg.timestampOriginal,
      tpMarc: desconsiderar ? 'D' : tpMarc,
      seqEntSaida: seq,
      fonteMarc: fonte,
      codHorContratual:
        !desconsiderar && ehPrimEntrada && opts.horario ? COD_HORARIO : undefined,
      motivo: motivo ?? undefined,
    });
  };

  for (const orig of originais) {
    const cancelada = cancelamentos.some((c) => mira(c, orig));
    const corr = correcoes.find((a) => mira(a, orig));
    if (cancelada) {
      emitir(orig, 'O', true, orig.motivo ?? 'Cancelamento');
    } else if (corr) {
      // Original desconsiderada + a correção incluída.
      emitir(orig, 'O', true, corr.motivo ?? 'Correção');
      emitir(corr, 'I', false, corr.motivo ?? 'Correção');
    } else {
      emitir(orig, 'O', false);
    }
  }
  for (const inc of inclusoes) {
    emitir(inc, 'I', false, inc.motivo ?? 'Inclusão');
  }

  // Ordena por vínculo e horário.
  marcacoes.sort(
    (a, b) =>
      a.idtVinculo - b.idtVinculo ||
      a.dataHoraMarc.localeCompare(b.dataHoraMarc),
  );

  const vinculos = [...vinculoPorCpf.values()].sort((a, b) => a.idt - b.idt);

  const datas = marcacoes.map((m) => m.dataHoraMarc).sort();
  const dataInicial = datas[0] ?? opts.dataGeracaoIso;
  const dataFinal = datas[datas.length - 1] ?? opts.dataGeracaoIso;

  const linhas: string[] = [];
  linhas.push(
    registroCabecalho(opts.empresa, dataInicial, dataFinal, opts.dataGeracaoIso),
  );
  linhas.push(registroRep(opts.inpi));
  for (const v of vinculos) linhas.push(registroVinculo(v));
  if (opts.horario) linhas.push(registroHorario(opts.horario));
  for (const m of marcacoes) linhas.push(registroMarcacao(m));
  linhas.push(registroPtrp(opts.ptrp));
  linhas.push(
    registroTrailer({
      t01: 1,
      t02: 1,
      t03: vinculos.length,
      t04: opts.horario ? 1 : 0,
      t05: marcacoes.length,
      t06: 0,
      t07: 0,
      t08: 1,
    }),
  );
  linhas.push(linhaAssinatura());

  return {
    conteudo: linhas.map((l) => `${l}\r\n`).join(''),
    nome: nomeArquivoAEJ(opts.inpi, opts.empresa.documento),
    totalMarcacoes: marcacoes.length,
    semCpf,
    assinado: false,
  };
}
