import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

/**
 * Global — qualquer módulo pode injetar `PrismaService` sem importar este
 * módulo explicitamente. Padrão comum pra data-access layer única.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
