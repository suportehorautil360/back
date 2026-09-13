/**
 * PrismaService — provider NestJS que expõe um `PrismaClient` singleton.
 *
 * Usa `@prisma/adapter-pg` (Prisma 7). Conexão via `DATABASE_URL` (pooler);
 * migrations rodam no repo `horautil` (fonte da verdade do schema).
 */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client";

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly log = new Logger(PrismaService.name);

  constructor() {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL não configurada.");
    }
    super({
      adapter: new PrismaPg({ connectionString: url }),
      // Os 5s padrão do Prisma para transação interativa são curtos para este
      // deploy: o banco é o pooler do Supabase, cada ida custa dezenas de
      // milissegundos, e uma transação do almoxarifado faz muitas — a reserva
      // de um kit trava uma linha de saldo por peça, grava item por item, abre
      // a solicitação de compra da falta e monta os avisos. Medido contra o
      // banco compartilhado: a reserva de um kit de 8 itens estourou os 5s, e
      // a varredura de estoque mínimo levou 92s esperando uma trava legítima.
      //
      // Trinta segundos não seguram trava por mais tempo — só evitam abortar
      // uma transação que estava progredindo. Quem segura de verdade continua
      // sendo a ordem única de trava (`modules/almoxarifado/transacao.ts`).
      transactionOptions: { timeout: 30_000, maxWait: 30_000 },
      log:
        process.env.NODE_ENV === "development"
          ? ["error", "warn"]
          : ["error"],
    });
  }

  async onModuleInit() {
    await this.$connect();
    this.log.log("Prisma conectado ao Postgres.");
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
