/**
 * Geração do AFD (Arquivo Fonte de Dados) — Portaria MTE 671/2021, Anexo V,
 * para REP-P. Funções PURAS (sem IO) para serem facilmente testáveis contra o
 * leiaute oficial.
 *
 * Regras do anexo:
 * - texto ISO-8859-1, 1 registro por linha terminada em CRLF (13,10);
 * - sem linhas em branco; registros ordenados por NSR;
 * - N (numérico): zero à esquerda; A (alfanumérico): espaço à direita;
 * - D: "AAAA-MM-dd"; DH: "AAAA-MM-ddThh:mm:00±HHMM" (segundos fixos "00");
 * - tipos 1..5: CRC-16; no REP-P usa-se CRC-16/KERMIT (CCITT-TRUE);
 * - tipo 7: hash SHA-256 dos campos 1..7 + hash do tipo-7 anterior.
 */
import { createHash } from 'node:crypto';

const TZ = 'America/Sao_Paulo';

// --- Formatação de campos --------------------------------------------------

/** Numérico: só dígitos, zero à esquerda, largura fixa. */
export function padN(valor: string | number, largura: number): string {
  const s = String(valor ?? '').replace(/\D/g, '');
  return s.length >= largura
    ? s.slice(s.length - largura)
    : s.padStart(largura, '0');
}

/** Alfanumérico: espaço à direita, largura fixa (sem quebras de linha). */
export function padA(valor: string, largura: number): string {
  const s = String(valor ?? '').replace(/[\r\n]+/g, ' ');
  return s.length >= largura ? s.slice(0, largura) : s.padEnd(largura, ' ');
}

function partesSP(d: Date): Record<string, string> {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const out: Record<string, string> = {};
  for (const p of dtf.formatToParts(d)) out[p.type] = p.value;
  return out;
}

/** Offset (minutos) do fuso de São Paulo no instante dado. */
function offsetMinSP(d: Date): number {
  const p = partesSP(d);
  const asUTC = Date.UTC(
    +p.year,
    +p.month - 1,
    +p.day,
    +p.hour,
    +p.minute,
    +p.second,
  );
  return Math.round((asUTC - d.getTime()) / 60000);
}

/** Campo D — data local de São Paulo no formato "AAAA-MM-dd". */
export function formatD(iso: string): string {
  const p = partesSP(new Date(iso));
  return `${p.year}-${p.month}-${p.day}`;
}

/** Campo DH — "AAAA-MM-ddThh:mm:00±HHMM" (segundos fixos "00"). */
export function formatDH(iso: string): string {
  const d = new Date(iso);
  const p = partesSP(d);
  const off = offsetMinSP(d);
  const sinal = off < 0 ? '-' : '+';
  const abs = Math.abs(off);
  const oh = String(Math.floor(abs / 60)).padStart(2, '0');
  const om = String(abs % 60).padStart(2, '0');
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00${sinal}${oh}${om}`;
}

// --- Integridade -----------------------------------------------------------

/**
 * CRC-16/KERMIT (CCITT-TRUE): poly 0x1021 refletido (0x8408), init 0, refin/
 * refout. Vetor oficial: "123456789" → "2189". Retorna 4 hex maiúsculos.
 */
export function crc16kermit(str: string): string {
  let crc = 0;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) & 0xff;
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >> 1) ^ 0x8408 : crc >> 1;
    }
  }
  return (crc & 0xffff).toString(16).toUpperCase().padStart(4, '0');
}

/** SHA-256 do conteúdo (bytes latin1), em hex maiúsculo. */
export function sha256Hex(str: string): string {
  return createHash('sha256')
    .update(Buffer.from(str, 'latin1'))
    .digest('hex')
    .toUpperCase();
}

// --- Construtores de registro ----------------------------------------------

export interface EmpresaAFD {
  razaoSocial: string;
  /** CNPJ ou CPF do empregador (só dígitos; 14=CNPJ, 11=CPF). */
  documento: string;
  /** CNO/CAEPF, quando existir. */
  caepf?: string;
}

export interface FabricanteAFD {
  /** Nº de registro no INPI (REP-P), 17 dígitos. */
  inpi: string;
  /** "1"=CNPJ, "2"=CPF. */
  tipoDoc: '1' | '2';
  documento: string;
  modelo?: string;
}

export interface MarcacaoAFD {
  nsr: number;
  timestampOriginal: string;
  cpf?: string | null;
  createdAt: string;
}

/** Coletor "02" = browser (PWA). Offline "0" = on-line. */
const COLETOR = '02';
const ONLINE = '0';

/** Registro tipo 1 — Cabeçalho (302 chars, com CRC-16/KERMIT). */
export function registroCabecalho(opts: {
  empresa: EmpresaAFD;
  fabricante: FabricanteAFD;
  dataInicialIso: string;
  dataFinalIso: string;
  dataGeracaoIso: string;
}): string {
  const docEmp = opts.empresa.documento.replace(/\D/g, '');
  const tipoIdEmp = docEmp.length === 11 ? '2' : '1';
  const corpo =
    padN('0', 9) + // 1
    '1' + // 2
    tipoIdEmp + // 3
    padN(docEmp, 14) + // 4
    padN(opts.empresa.caepf ?? '', 14) + // 5
    padA(opts.empresa.razaoSocial, 150) + // 6
    padN(opts.fabricante.inpi, 17) + // 7
    formatD(opts.dataInicialIso) + // 8
    formatD(opts.dataFinalIso) + // 9
    formatDH(opts.dataGeracaoIso) + // 10
    '003' + // 11
    opts.fabricante.tipoDoc + // 12
    padN(opts.fabricante.documento, 14) + // 13
    padA(opts.fabricante.modelo ?? '', 30); // 14
  return corpo + crc16kermit(corpo);
}

/**
 * Registro tipo 7 — Marcação REP-P (137 chars). Retorna a linha e o hash, que
 * encadeia no próximo registro. `cpf` ausente → zeros (12) e contabilizado fora.
 */
export function registroMarcacao(
  m: MarcacaoAFD,
  hashAnterior: string,
): { linha: string; hash: string } {
  const corpo =
    padN(m.nsr, 9) + // 1
    '7' + // 2
    formatDH(m.timestampOriginal) + // 3
    padN(m.cpf ?? '', 12) + // 4
    formatDH(m.createdAt) + // 5
    COLETOR + // 6
    ONLINE; // 7
  const hash = sha256Hex(corpo + hashAnterior); // campo 8
  return { linha: corpo + hash, hash };
}

/** Registro tipo 9 — Trailer (64 chars). Tipos 2..6 = 0 nesta etapa. */
export function registroTrailer(qtdTipo7: number): string {
  return (
    '999999999' + // 1
    padN(0, 9) + // 2 (tipo 2)
    padN(0, 9) + // 3 (tipo 3)
    padN(0, 9) + // 4 (tipo 4)
    padN(0, 9) + // 5 (tipo 5)
    padN(0, 9) + // 6 (tipo 6)
    padN(qtdTipo7, 9) + // 7 (tipo 7)
    '9' // 8
  );
}

/** Linha de assinatura digital (100 chars). O .p7s real é a etapa 4. */
export function linhaAssinatura(): string {
  return padA('ASSINATURA_DIGITAL_EM_ARQUIVO_P7S', 100);
}

/** Nome do arquivo AFD (REP-P): "AFD"+INPI+doc empregador+"REP_P". */
export function nomeArquivoAFD(inpi: string, docEmpregador: string): string {
  return `AFD${padN(inpi, 17)}${docEmpregador.replace(/\D/g, '')}REP_P.txt`;
}

export interface ResultadoAFD {
  conteudo: string;
  nome: string;
  totalMarcacoes: number;
  semCpf: number;
  /** Se o AFD foi assinado com certificado ICP-Brasil (etapa 4). */
  assinado: boolean;
  /** Assinatura destacada (.p7s) em base64, quando assinado. */
  assinaturaP7sBase64?: string;
}

/**
 * Monta o AFD completo (cabeçalho + N× tipo 7 ordenados por NSR + trailer +
 * assinatura), com hash encadeado. `marcacoes` deve vir só com registros
 * `original` (marcações cruas). Conteúdo com cada linha terminada em CRLF.
 */
export function montarAFD(opts: {
  empresa: EmpresaAFD;
  fabricante: FabricanteAFD;
  marcacoes: MarcacaoAFD[];
  dataGeracaoIso: string;
}): ResultadoAFD {
  const marcacoes = [...opts.marcacoes].sort((a, b) => a.nsr - b.nsr);
  const datas = marcacoes.map((m) => m.timestampOriginal).sort();
  const dataInicialIso = datas[0] ?? opts.dataGeracaoIso;
  const dataFinalIso = datas[datas.length - 1] ?? opts.dataGeracaoIso;

  const linhas: string[] = [
    registroCabecalho({
      empresa: opts.empresa,
      fabricante: opts.fabricante,
      dataInicialIso,
      dataFinalIso,
      dataGeracaoIso: opts.dataGeracaoIso,
    }),
  ];

  let hashAnterior = '';
  let semCpf = 0;
  for (const m of marcacoes) {
    if (!(m.cpf ?? '').replace(/\D/g, '')) semCpf++;
    const { linha, hash } = registroMarcacao(m, hashAnterior);
    linhas.push(linha);
    hashAnterior = hash;
  }

  linhas.push(registroTrailer(marcacoes.length));
  linhas.push(linhaAssinatura());

  return {
    conteudo: linhas.map((l) => `${l}\r\n`).join(''),
    nome: nomeArquivoAFD(opts.fabricante.inpi, opts.empresa.documento),
    totalMarcacoes: marcacoes.length,
    semCpf,
    assinado: false,
  };
}
