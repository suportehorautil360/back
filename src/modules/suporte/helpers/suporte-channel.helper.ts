import { BadRequestException } from '@nestjs/common';
import {
  SUPORTE_CHANNELS,
  type SuporteChannel,
} from '../suporte.types';

export function parseSuporteChannel(value: unknown): SuporteChannel {
  const channel = typeof value === 'string' ? value.trim().toLowerCase() : '';

  if (!SUPORTE_CHANNELS.includes(channel as SuporteChannel)) {
    throw new BadRequestException(
      'channel inválido. Use financeiro ou ti.',
    );
  }

  return channel as SuporteChannel;
}

export function welcomeMessageId(channel: SuporteChannel): string {
  return `welcome-${channel}`;
}

export function isWelcomeMessageId(id: string): boolean {
  return id.startsWith('welcome-');
}
