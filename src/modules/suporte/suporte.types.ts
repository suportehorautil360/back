export const SUPORTE_CHANNELS = ['financeiro', 'ti'] as const;
export type SuporteChannel = (typeof SUPORTE_CHANNELS)[number];

export const SUPORTE_SENDERS = ['user', 'support'] as const;
export type SuporteSender = (typeof SUPORTE_SENDERS)[number];

export interface SuporteMensagemApi {
  id: string;
  oficinaId?: string;
  postoId?: string;
  prefeituraId?: string;
  channel: SuporteChannel;
  sender: SuporteSender;
  text: string;
  createdAt: string;
  readAt?: string | null;
  /** Gestor leu mensagem do operador (inbox 360). */
  adminReadAt?: string | null;
  /** Resposta automática do sistema (não é humano). */
  autoReply?: boolean;
}

export interface SuporteThreadApi {
  postoId: string;
  channel: SuporteChannel;
  lastMessage: string;
  lastMessageAt: string;
  lastSender: SuporteSender;
  unreadUserCount: number;
}

export interface SuporteMensagemFirestore {
  id: string;
  oficinaId?: string;
  postoId?: string;
  channel: SuporteChannel;
  sender: SuporteSender;
  text: string;
  createdAt: string;
  readAt?: string | null;
  adminReadAt?: string | null;
  autoReply?: boolean;
  parceiroId?: string;
  prefeituraId?: string;
}

export interface SuporteResumoApi {
  unreadCount: number;
  channels: Record<
    SuporteChannel,
    {
      unreadCount: number;
      lastMessageAt: string | null;
    }
  >;
  online: boolean;
}
