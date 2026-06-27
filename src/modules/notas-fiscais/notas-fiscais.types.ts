export const NOTA_FISCAL_STATUS = ['pendente', 'aprovada', 'rejeitada'] as const;
export type NotaFiscalStatus = (typeof NOTA_FISCAL_STATUS)[number];

export const NOTA_FISCAL_CATEGORY = [
  'servico',
  'peca',
  'combustivel',
  'outros',
] as const;
export type NotaFiscalCategory = (typeof NOTA_FISCAL_CATEGORY)[number];

export const NOTA_FISCAL_DOCUMENT_TYPE = ['nfe-55', 'nfce-65'] as const;
export type NotaFiscalDocumentType = (typeof NOTA_FISCAL_DOCUMENT_TYPE)[number];

export interface NotaFiscalApiItem {
  id: string;
  oficinaId: string;
  /** Dono quando a nota é enviada por um posto (combustível), não por oficina. */
  postoId?: string;
  parceiroId?: string;
  prefeituraId?: string;
  solicitacaoOsId?: string;
  description: string;
  category: NotaFiscalCategory;
  documentType: NotaFiscalDocumentType;
  number: string;
  issuerName: string;
  issuedAt: string;
  accessKey: string;
  value: number;
  status: NotaFiscalStatus;
  fileName: string;
  fileUrl: string;
  createdAt: string;
  /** completo = chave extraída; parcial = PDF salvo, leitura incompleta */
  parseCompleteness?: 'completo' | 'parcial';
}

export interface NotaFiscalFirestore {
  id: string;
  oficinaId?: string;
  postoId?: string;
  parceiroId?: string;
  prefeituraId?: string;
  solicitacaoOsId?: string;
  description: string;
  category: NotaFiscalCategory;
  documentType: NotaFiscalDocumentType;
  number: string;
  issuerName: string;
  issuedAt: string;
  accessKey: string;
  value: number;
  status: NotaFiscalStatus;
  fileName: string;
  fileUrl: string;
  parseCompleteness?: 'completo' | 'parcial';
  criadoEm?: unknown;
}
