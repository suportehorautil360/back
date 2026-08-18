import type { PrismaService } from '../../prisma/prisma.service';
import {
  formatProtocol,
  parseProtocolSeq,
} from '../../modules/os/helpers/gerar-protocolo.helper';

/** Próximo protocolo sequencial por empresa e ano civil (Postgres). */
export async function nextProtocoloOsPg(
  prisma: PrismaService,
  companyId: string,
  year = new Date().getFullYear(),
): Promise<string> {
  const rows = await prisma.serviceOrder.findMany({
    where: { companyId },
    select: { protocolo: true },
  });

  let maxSeq = 0;
  for (const row of rows) {
    const seq = parseProtocolSeq(row.protocolo, year);
    if (seq !== null && seq > maxSeq) maxSeq = seq;
  }

  return formatProtocol(year, maxSeq + 1);
}
