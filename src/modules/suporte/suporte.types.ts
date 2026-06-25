export const SUPORTE_CHANNELS = ['financeiro', 'ti'] as const;
export type SuporteChannel = (typeof SUPORTE_CHANNELS)[number];

export const SUPORTE_SENDERS = ['user', 'support'] as const;
export type SuporteSender = (typeof SUPORTE_SENDERS)[number];

export interface SuporteMensagemApi {
  id: string;
  oficinaId: string;
  channel: SuporteChannel;
  sender: SuporteSender;
  text: string;
  createdAt: string;
  readAt?: string | null;
}

export interface SuporteMensagemFirestore {
  id: string;
  oficinaId: string;
  channel: SuporteChannel;
  sender: SuporteSender;
  text: string;
  createdAt: string;
  readAt?: string | null;
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
