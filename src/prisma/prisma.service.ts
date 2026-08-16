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
