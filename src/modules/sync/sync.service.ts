import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { resolverCompanyId } from '../../common/prisma/company-resolver';
import { mapEquipmentToApi } from '../../common/prisma/equipment-api.mapper';
import {
  codificarCursor,
  decodificarCursor,
  type PosicaoDoCursor,
} from '../../common/sync/cursor';

/** Coleções que o app espelha localmente. */
export const COLECOES = ['equipamentos'] as const;
export type Colecao = (typeof COLECOES)[number];

function ehColecaoConhecida(v: string): v is Colecao {
  return (COLECOES as readonly string[]).includes(v);
}

export type LotePull = {
  mudancas: unknown[];
  /** Ids removidos desde o cursor — o app apaga do espelho. */
  remocoes: string[];
  /** Devolver ao servidor no próximo pull. Opaco para o cliente. */
  proximoCursor: string | null;
  temMais: boolean;
  /** Alimenta a correção de relógio do aparelho. */
  servidorAgora: string;
};

const LIMITE_PADRAO = 300;
const LIMITE_MAXIMO = 1000;

@Injectable()
export class SyncService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Página seguinte da coleção, a partir do cursor.
   *
   * Paginação keyset por `(updated_at, id)` em vez de OFFSET: com dezenas de
   * milhares de equipamentos, `OFFSET 20000` varre 20 mil linhas a cada
   * página. E o `id` no par não é detalhe — sem ele, dois registros gravados
   * no mesmo milissegundo fazem a paginação pular um deles em silêncio.
   */
  async puxar(
    companyId: string,
    // `string`, não `Colecao`: o valor vem de um segmento de URL e pode ser
    // qualquer coisa. Tipar como a união aqui seria otimismo — a validação
    // abaixo é que faz dele uma coleção conhecida.
    colecao: string,
    cursorBruto?: string,
    limiteBruto?: number,
  ): Promise<LotePull> {
    if (!ehColecaoConhecida(colecao)) {
      throw new NotFoundException(`Coleção desconhecida: ${colecao}`);
    }

    // O app manda o legacyId (é o que o resolver-chassi devolve), mas
    // `equipments.company_id` guarda o UUID do Postgres. Os dois se parecem —
    // ambos são UUID — então consultar sem resolver não estoura: devolve zero
    // equipamento, e o operador fica sem frota sem nenhum erro na tela.
    const companyIdReal = await resolverCompanyId(this.prisma, companyId);
    if (!companyIdReal) {
      // Lista vazia faria o app apagar o espelho inteiro achando que a frota
      // acabou. Falhar alto preserva o que já está no aparelho.
      throw new NotFoundException(`Empresa não encontrada: ${companyId}`);
    }
    const limite = Math.min(
      Math.max(Number(limiteBruto) || LIMITE_PADRAO, 1),
      LIMITE_MAXIMO,
    );
    const desde = decodificarCursor(cursorBruto);

    const rows = await this.prisma.equipment.findMany({
      where: { companyId: companyIdReal, ...this.apartirDe(desde) },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      // Uma a mais para saber se há próxima página sem um COUNT separado.
      take: limite + 1,
    });

    const temMais = rows.length > limite;
    const pagina = temMais ? rows.slice(0, limite) : rows;
    const ultimo = pagina.at(-1);

    return {
      mudancas: pagina.map((r) => mapEquipmentToApi(r, companyId)),
      remocoes: await this.remocoes(companyIdReal, colecao, desde),
      proximoCursor: ultimo
        ? codificarCursor({ atualizadoEm: ultimo.updatedAt, id: ultimo.id })
        : (cursorBruto ?? null),
      temMais,
      servidorAgora: new Date().toISOString(),
    };
  }

  /** Keyset: `(updated_at, id) > (cursor.t, cursor.i)`. */
  private apartirDe(desde: PosicaoDoCursor | null) {
    if (!desde) return {};
    return {
      OR: [
        { updatedAt: { gt: desde.atualizadoEm } },
        { updatedAt: desde.atualizadoEm, id: { gt: desde.id } },
      ],
    };
  }

  /**
   * Remoções desde o cursor. Primeiro pull (sem cursor) não traz nenhuma: o
   * aparelho ainda não tem espelho, então não há o que apagar — e mandar a
   * lista inteira de lápides seria desperdício puro.
   */
  private async remocoes(
    companyId: string,
    colecao: Colecao,
    desde: PosicaoDoCursor | null,
  ): Promise<string[]> {
    if (!desde) return [];
    const lapides = await this.prisma.syncTombstone.findMany({
      where: { companyId, colecao, deletadoEm: { gt: desde.atualizadoEm } },
      select: { registroId: true },
      take: LIMITE_MAXIMO,
    });
    return lapides.map((l) => l.registroId);
  }
}
