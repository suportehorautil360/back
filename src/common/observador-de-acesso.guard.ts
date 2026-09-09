import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { PUBLICO_KEY } from './publico.decorator';

/**
 * Fase 2 do fechamento da API: observa, não barra.
 *
 * Em 09/09/2026, 132 das 197 rotas do back não exigiam autenticação. O destino
 * é um guard global fechado por padrão — mas virar a chave apostando na minha
 * leitura de código derruba, no meio de um turno, algum cliente que o código
 * não revela. Esse risco não é teórico: o primeiro mapa que levantei já estava
 * errado sobre quem chama o quê, e só não quebrou o ponto no painel porque
 * conferi antes.
 *
 * Então este guard **sempre deixa passar**. Ele só anota quem chegou sem
 * credencial, para a fase 3 fechar com tráfego real em vez de palpite.
 *
 * O que ele NÃO detecta, e é deliberado: token presente porém inválido,
 * expirado ou de outro emissor. Verificar assinatura aqui custaria uma ida ao
 * JWKS por requisição, e a pergunta da fase 2 é outra — "quem chama sem
 * nenhuma credencial". O caso do token errado é menor e aparece na fase 3.
 */
@Injectable()
export class ObservadorDeAcesso implements CanActivate {
  private readonly logger = new Logger(ObservadorDeAcesso.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    // Só HTTP. Um contexto de WebSocket ou RPC não tem `request`, e tentar ler
    // um daria erro dentro de um guard que promete nunca atrapalhar.
    if (ctx.getType() !== 'http') return true;

    const publico = this.reflector.getAllAndOverride<boolean>(PUBLICO_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (publico) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    if (!temCredencial(req)) {
      // Fire-and-forget: o registro é diagnóstico, e ninguém pode ficar
      // esperando o banco para receber a resposta. Falha aqui vira log, nunca
      // erro na requisição de quem está em campo.
      void this.registrar(ctx, req).catch((e: unknown) => {
        this.logger.warn(
          `Falha ao registrar acesso sem token: ${e instanceof Error ? e.message : String(e)}`,
        );
      });
    }

    return true;
  }

  private async registrar(ctx: ExecutionContext, req: Request): Promise<void> {
    const controller = ctx.getClass().name;
    const handler = ctx.getHandler().name;
    const metodo = req.method;
    const origem = corta(req.headers.origin ?? req.headers.referer, 200);
    const userAgent = corta(req.headers['user-agent'], 160);

    const chave = createHash('sha256')
      .update([controller, handler, metodo, origem ?? '', userAgent ?? ''].join('|'))
      .digest('hex');

    const agora = new Date();
    await this.prisma.apiAcessoSemToken.upsert({
      where: { chave },
      create: {
        chave,
        controller,
        handler,
        metodo,
        origem,
        userAgent,
        primeiraEm: agora,
        ultimaEm: agora,
      },
      update: { total: { increment: 1 }, ultimaEm: agora },
    });
  }
}

/**
 * Tem crachá?
 *
 * Basta um `Bearer` com cara de JWT — três partes separadas por ponto. Não
 * confere assinatura de propósito (ver o cabeçalho da classe): o que se quer
 * saber na fase 2 é quem chega sem nada.
 */
export function temCredencial(req: {
  headers: Record<string, unknown>;
}): boolean {
  const header = req.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;

  const token = header.slice(7).trim();
  return token.split('.').length === 3 && token.length > 20;
}

/** Cabeçalho de terceiro não tem limite de tamanho; a coluna do banco tem. */
function corta(valor: unknown, max: number): string | null {
  if (typeof valor !== 'string') return null;
  const limpo = valor.trim();
  return limpo ? limpo.slice(0, max) : null;
}
