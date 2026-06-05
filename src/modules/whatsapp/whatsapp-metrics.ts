/** Funções puras de métricas do Hub WhatsApp (sem I/O — fáceis de testar). */

export type WhatsAppStatus =
  | 'desconectado'
  | 'conectando'
  | 'aguardando_qr'
  | 'conectado';

export type TipoEventoWhats =
  | 'sessao_iniciada'
  | 'qr_gerado'
  | 'conectado'
  | 'queda'
  | 'sessao_encerrada';

export type StatusEventoWhats = 'sucesso' | 'aviso' | 'erro';

export interface EventoWhats {
  id: string;
  tipo: TipoEventoWhats;
  status: StatusEventoWhats;
  timestamp: string;
}

export interface ConfigWhats {
  alertas?: { notificacaoWhatsapp?: boolean };
  empresa?: { whatsappNumero?: string };
}

/** Conta empresas com a notificação de emergência ligada E número cadastrado. */
export function contarEmpresasComWhats(configs: ConfigWhats[]): number {
  return configs.filter(
    (c) =>
      c.alertas?.notificacaoWhatsapp === true &&
      (c.empresa?.whatsappNumero ?? '').trim() !== '',
  ).length;
}
