import type {
  NotaFiscalCategory,
  NotaFiscalDocumentType,
} from '../notas-fiscais.types';

export type NotaFiscalParseCompleteness = 'completo' | 'parcial';

export interface ParsedDanfeData {
  description: string;
  category: NotaFiscalCategory;
  documentType: NotaFiscalDocumentType;
  number: string;
  issuerName: string;
  issuedAt: string;
  accessKey: string;
  value: number;
  parseCompleteness: NotaFiscalParseCompleteness;
}

type PdfParseFn = (buffer: Buffer) => Promise<{ text?: string }>;

function getPdfParser(): PdfParseFn {
  // pdf-parse v1 — só extração de texto, sem @napi-rs/canvas (funciona em Lambda/Vercel).
  // A v2 quebra em prod com DOMMatrix is not defined.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('pdf-parse') as PdfParseFn;
}

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function parseBrazilianMoney(raw: string): number | null {
  const cleaned = raw.trim().replace(/[^\d,.-]/g, '');
  if (!cleaned) return null;

  const normalized = cleaned.includes(',')
    ? cleaned.replace(/\./g, '').replace(',', '.')
    : cleaned;
  const value = Number(normalized);

  return Number.isFinite(value) && value >= 0 ? value : null;
}

function parseBrDate(raw: string): string | null {
  const match = raw.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!match) return null;

  const [, day, month, year] = match;
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    12,
    0,
    0,
    0,
  );

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function extractAccessKeys(text: string): string[] {
  const compact = text.replace(/\s+/g, '');
  const matches = compact.match(/\d{44}/g) ?? [];
  return [...new Set(matches)];
}

export function parseAccessKeyFields(accessKey: string): {
  documentType: NotaFiscalDocumentType;
  number: string;
  issuedAt: string | null;
} | null {
  const digits = accessKey.replace(/\D/g, '');
  if (digits.length !== 44) return null;

  const mod = digits.slice(20, 22);
  const documentType: NotaFiscalDocumentType =
    mod === '65' ? 'nfce-65' : 'nfe-55';
  const number = digits.slice(25, 34).replace(/^0+/, '') || '0';
  const year = 2000 + Number(digits.slice(2, 4));
  const month = Number(digits.slice(4, 6));

  let issuedAt: string | null = null;
  if (month >= 1 && month <= 12) {
    const date = new Date(year, month - 1, 1, 12, 0, 0, 0);
    issuedAt = Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  return { documentType, number, issuedAt };
}

function pickAccessKey(text: string): string {
  const keys = extractAccessKeys(text);
  if (!keys.length) return '';

  const preferred = keys.find((key) => {
    const mod = key.slice(20, 22);
    return mod === '55' || mod === '65';
  });

  return preferred ?? keys[0];
}

function firstXmlTag(text: string, tag: string): string {
  const regex = new RegExp(`<${tag}>([^<]+)</${tag}>`, 'i');
  const match = text.match(regex);
  return match ? normalizeWhitespace(match[1]) : '';
}

function parseFromEmbeddedXml(text: string): Partial<ParsedDanfeData> | null {
  if (!/<(?:nfeProc|NFe|infNFe)/i.test(text)) {
    return null;
  }

  const accessKey =
    firstXmlTag(text, 'chNFe') ||
    (text.match(/Id="NFe(\d{44})"/i)?.[1] ?? '');

  const mod = firstXmlTag(text, 'mod');
  const documentType: NotaFiscalDocumentType | undefined =
    mod === '65' ? 'nfce-65' : mod === '55' ? 'nfe-55' : undefined;

  const number = firstXmlTag(text, 'nNF');
  const issuerName = firstXmlTag(text, 'xNome');
  const issuedAt =
    parseBrDate(firstXmlTag(text, 'dhEmi')) ??
    (firstXmlTag(text, 'dhEmi')
      ? new Date(firstXmlTag(text, 'dhEmi')).toISOString()
      : null);
  const value = parseBrazilianMoney(firstXmlTag(text, 'vNF'));
  const description = firstXmlTag(text, 'xProd');

  const parsed: Partial<ParsedDanfeData> = {};

  if (accessKey.replace(/\D/g, '').length === 44) {
    parsed.accessKey = accessKey.replace(/\D/g, '');
  }
  if (documentType) parsed.documentType = documentType;
  if (number) parsed.number = number.replace(/^0+/, '') || '0';
  if (issuerName) parsed.issuerName = issuerName;
  if (issuedAt) parsed.issuedAt = issuedAt;
  if (value !== null) parsed.value = value;
  if (description) parsed.description = description;

  return Object.keys(parsed).length ? parsed : null;
}

function parseIssuerNameFromText(text: string): string {
  const patterns = [
    /RAZ[AÃ]O\s*SOCIAL[:\s-]*([^\n]+)/i,
    /NOME\s*\/\s*RAZ[AÃ]O\s*SOCIAL[:\s-]*([^\n]+)/i,
    /IDENTIFICA[CÇ][AÃ]O\s*DO\s*EMITENTE[\s\S]{0,120}?([A-Z0-9][A-Z0-9\s.&-]{4,80})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return normalizeWhitespace(match[1]).slice(0, 120);
    }
  }

  return '';
}

function parseIssuedAtFromText(text: string): string | null {
  const patterns = [
    /(?:DATA\s*(?:DE\s*)?EMISS[AÃ]O|EMISS[AÃ]O)[:\s]*(\d{2}\/\d{2}\/\d{4})/i,
    /(\d{2}\/\d{2}\/\d{4})/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const parsed = parseBrDate(match[1]);
      if (parsed) return parsed;
    }
  }

  return null;
}

function parseValueFromText(text: string): number | null {
  const patterns = [
    /VALOR\s*TOTAL\s*(?:DA\s*NOTA|NF)?[:\s]*R?\$?\s*([\d.,]+)/i,
    /VALOR\s*TOTAL\s*DOS\s*PRODUTOS[:\s]*R?\$?\s*([\d.,]+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const parsed = parseBrazilianMoney(match[1]);
      if (parsed !== null) return parsed;
    }
  }

  return null;
}

function parseNumberFromText(text: string): string {
  const patterns = [
    /N[ºo°\.]\s*(?:DA\s*NOTA)?[:\s]*(\d{1,9})/i,
    /NÚMERO[:\s]*(\d{1,9})/i,
    /NUMERO[:\s]*(\d{1,9})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].replace(/^0+/, '') || '0';
  }

  return '';
}

function parseDescriptionFromText(text: string): string {
  const patterns = [
    /DESCRI[CÇ][AÃ]O\s*DO\s*PRODUTO[\s\S]{0,200}?([A-Z0-9][^\n]{8,120})/i,
    /DADOS\s*DOS\s*PRODUTOS[\s\S]{0,400}?([A-Z0-9][^\n]{8,120})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return normalizeWhitespace(match[1]).slice(0, 160);
    }
  }

  return '';
}

function inferDocumentType(text: string): NotaFiscalDocumentType {
  if (/NFC-?e|MOD(?:ELO)?\s*0*65|modelo\s*65/i.test(text)) {
    return 'nfce-65';
  }

  return 'nfe-55';
}

export function inferNotaFiscalCategory(description: string): NotaFiscalCategory {
  const normalized = description.toLowerCase();

  if (
    /combust|diesel|gasolina|etanol|gnv|arla|lubrific/.test(normalized)
  ) {
    return 'combustivel';
  }

  if (
    /pe[cç]a|filtro|rolamento|retentor|kit|parafuso|correia|pneu|bateria/.test(
      normalized,
    )
  ) {
    return 'peca';
  }

  if (
    /servi[cç]o|m[aã]o de obra|reparo|manuten[cç][aã]o|hidr[aá]ulic|mec[aâ]nic/.test(
      normalized,
    )
  ) {
    return 'servico';
  }

  return 'outros';
}

function descriptionFromFileName(fileName: string): string {
  return (
    fileName.replace(/\.pdf$/i, '').replace(/[_-]/g, ' ').trim() || 'Nota fiscal'
  );
}

function resolveParseCompleteness(accessKey: string): NotaFiscalParseCompleteness {
  return accessKey.replace(/\D/g, '').length === 44 ? 'completo' : 'parcial';
}

function buildPartialFromFileName(fileName: string): ParsedDanfeData {
  const description = descriptionFromFileName(fileName);
  return {
    description,
    category: inferNotaFiscalCategory(description),
    documentType: inferDocumentType(fileName),
    number: '0',
    issuerName: 'Aguardando leitura do PDF',
    issuedAt: new Date().toISOString(),
    accessKey: '',
    value: 0,
    parseCompleteness: 'parcial',
  };
}

export function parseDanfeText(
  text: string,
  fileName: string,
): ParsedDanfeData {
  const normalizedText = text.replace(/\u0000/g, ' ').trim();
  if (!normalizedText) {
    return buildPartialFromFileName(fileName);
  }

  const fromXml = parseFromEmbeddedXml(normalizedText) ?? {};
  const accessKey =
    fromXml.accessKey || pickAccessKey(normalizedText);
  const keyFields = accessKey ? parseAccessKeyFields(accessKey) : null;

  const documentType =
    fromXml.documentType ??
    keyFields?.documentType ??
    inferDocumentType(normalizedText);
  const number =
    fromXml.number ?? keyFields?.number ?? parseNumberFromText(normalizedText);
  const issuerName =
    fromXml.issuerName || parseIssuerNameFromText(normalizedText);
  const issuedAt =
    fromXml.issuedAt ??
    parseIssuedAtFromText(normalizedText) ??
    keyFields?.issuedAt ??
    new Date().toISOString();
  const value =
    fromXml.value ?? parseValueFromText(normalizedText) ?? 0;
  const description =
    fromXml.description ||
    parseDescriptionFromText(normalizedText) ||
    issuerName ||
    descriptionFromFileName(fileName);

  const category = inferNotaFiscalCategory(description);
  const normalizedKey = accessKey.replace(/\D/g, '');

  return {
    description,
    category,
    documentType,
    number: number || '0',
    issuerName: issuerName || 'Aguardando leitura do PDF',
    issuedAt,
    accessKey: normalizedKey.length === 44 ? normalizedKey : '',
    value,
    parseCompleteness: resolveParseCompleteness(
      normalizedKey.length === 44 ? normalizedKey : '',
    ),
  };
}

export async function extractPdfText(buffer: Buffer): Promise<string> {
  const pdfParse = getPdfParser();
  const result = await pdfParse(buffer);
  return result.text ?? '';
}

export async function parseDanfePdf(
  buffer: Buffer,
  fileName: string,
): Promise<ParsedDanfeData> {
  const text = await extractPdfText(buffer);
  return parseDanfeText(text, fileName);
}
