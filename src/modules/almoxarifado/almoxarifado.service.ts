import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizarCodigo } from './regras/codigo';
import { Prisma } from '../../prisma/generated/client';
import { disponivel } from './regras/disponibilidade';
import { novoCustoMedio } from './regras/movimento';
import { statusAposConsulta, type StatusMateriais } from './regras/status-materiais';
import { itensDeTrocaDoCiclo, resolverPeca, type ItemDeTroca } from './regras/plano-pecas';

export interface ItemReservado {
  linhaId: string;
  pecaId: string | null;
  descricao: string;
  /** Vem do plano ("L", "un"). O painel usa no rótulo "8 de 15 L". */
  unidade: string | null;
  quantidadeSolicitada: number;
  quantidadeReservada: number;
  quantidadeFaltante: number;
  impeditivo: boolean;
  status: 'reservada' | 'faltante' | 'nao_vinculado';
}

export interface ResultadoDaReserva {
  requisicaoId: string;
  numero: string;
  statusMateriais: StatusMateriais;
  itens: ItemReservado[];
}

@Injectable()
export class AlmoxarifadoService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Uma busca só para os dois códigos.
   *
   * Devolve LISTA porque `codigo_fabricante` não é único: duas marcas
   * equivalentes repetem part number, e escolher uma por conta própria
   * entregaria a peça errada.
   */
  async buscarPorCodigo(companyId: string, codigo: string) {
    const alvo = normalizarCodigo(codigo);
    if (!alvo) return [];
    return this.prisma.peca.findMany({
      where: {
        companyId,
        ativo: true,
        OR: [{ codigoInterno: alvo }, { codigoFabricante: alvo }],
      },
      include: { saldos: { include: { deposito: true } } },
      orderBy: { descricao: 'asc' },
      take: 20,
    });
  }

  /**
   * Reserva o que existe e marca o que falta, numa transação só.
   *
   * `SELECT … FOR UPDATE` na linha de `peca_saldos` é a regra inteira: ler o
   * saldo, decidir e gravar em chamadas separadas deixa duas OS abertas no mesmo
   * segundo contarem com a mesma última unidade — que é justamente o que a
   * "regra de concorrência" do spec proíbe.
   *
   * A reserva NUNCA nasce no aparelho. O app enfileira a intenção; quem decide
   * quem fica com a última unidade é este método, no instante em que o pedido
   * chega.
   */
  async reservarParaOs(
    input: {
      companyId: string;
      serviceOrderId: string;
      depositoId: string;
      autorCompanyUserId: string;
      categoriaPlanoId: string;
      cicloId: string;
    },
    /**
     * Só para teste: injeta os itens já resolvidos e pula a leitura do plano.
     * Em produção NUNCA é passado — quem resolve o plano é este método.
     */
    override?: { itensDoPlano: ItemDeTroca[] },
  ): Promise<ResultadoDaReserva> {
    const itens = override?.itensDoPlano ?? (await this.itensDoPlanoDaOs(input));

    return this.prisma.$transaction(async (tx) => {
      const resultado: ItemReservado[] = [];

      for (const item of itens) {
        if (!item.pecaId) {
          resultado.push({
            linhaId: item.linhaId, pecaId: null, descricao: item.descricao,
            unidade: item.unidade,
            quantidadeSolicitada: item.quantidade, quantidadeReservada: 0,
            quantidadeFaltante: item.quantidade, impeditivo: item.impeditivo,
            status: 'nao_vinculado',
          });
          continue;
        }

        const linhas = await tx.$queryRaw<
          { saldo_fisico: string; saldo_reservado: string }[]
        >(Prisma.sql`
          SELECT saldo_fisico, saldo_reservado
            FROM peca_saldos
           WHERE peca_id = ${item.pecaId}::uuid
             AND deposito_id = ${input.depositoId}::uuid
             FOR UPDATE
        `);

        const saldo = linhas[0]
          ? {
              saldoFisico: Number(linhas[0].saldo_fisico),
              saldoReservado: Number(linhas[0].saldo_reservado),
              saldoSeparado: 0,
              saldoEmCompra: 0,
            }
          : null;

        const livre = saldo ? disponivel(saldo) : 0;
        const reservar = Math.min(livre, item.quantidade);
        const faltante = item.quantidade - reservar;

        if (reservar > 0) {
          await tx.$executeRaw(Prisma.sql`
            UPDATE peca_saldos
               SET saldo_reservado = saldo_reservado + ${reservar},
                   updated_at = now()
             WHERE peca_id = ${item.pecaId}::uuid
               AND deposito_id = ${input.depositoId}::uuid
          `);
        }

        resultado.push({
          linhaId: item.linhaId, pecaId: item.pecaId, descricao: item.descricao,
          unidade: item.unidade,
          quantidadeSolicitada: item.quantidade, quantidadeReservada: reservar,
          quantidadeFaltante: faltante, impeditivo: item.impeditivo,
          status: faltante > 0 ? 'faltante' : 'reservada',
        });
      }

      const numero = await this.proximoNumeroRequisicao(tx, input.companyId);
      const req = await tx.requisicaoMaterial.create({
        data: {
          companyId: input.companyId,
          numero,
          serviceOrderId: input.serviceOrderId,
          depositoId: input.depositoId,
          solicitanteCompanyUserId: input.autorCompanyUserId,
        },
        select: { id: true, numero: true },
      });

      for (const r of resultado) {
        if (!r.pecaId) continue;
        await tx.requisicaoMaterialItem.create({
          data: {
            requisicaoId: req.id,
            pecaId: r.pecaId,
            planoLinhaId: r.linhaId,
            quantidadeSolicitada: r.quantidadeSolicitada,
            quantidadeReservada: r.quantidadeReservada,
            impeditivo: r.impeditivo,
            status: r.status,
          },
        });
      }

      const statusMateriais = statusAposConsulta(
        resultado
          .filter((r) => r.pecaId)
          .map((r) => ({ impeditivo: r.impeditivo, status: r.status })),
      );

      await tx.serviceOrder.update({
        where: { id: input.serviceOrderId },
        data: { statusMateriais },
      });

      return { requisicaoId: req.id, numero: req.numero, statusMateriais, itens: resultado };
    });
  }

  /**
   * Os itens de troca do ciclo, com a peça já resolvida contra o catálogo.
   *
   * Lê o plano do MODELO do equipamento da OS, como `getPlanoParaModelo` faz no
   * painel. Fora da transação de propósito: é leitura, e prender a linha do
   * saldo enquanto se lê um Json não ajuda ninguém.
   *
   * A checagem de posse (`companyId` no `findFirst` + `NotFoundException` se
   * vier vazio) segue o padrão de `mecanica.service.ts`
   * (`relatosDoOperador`, entre outros): sem ela, um `serviceOrderId` de outra
   * empresa passaria batido até `tx.serviceOrder.update`, que grava por `id`
   * sozinho — a única barreira contra escrever na OS de outro inquilino é
   * ESTA validação acontecer antes de entrar na transação.
   */
  private async itensDoPlanoDaOs(input: {
    companyId: string;
    serviceOrderId: string;
    categoriaPlanoId: string;
    cicloId: string;
  }): Promise<ItemDeTroca[]> {
    const os = await this.prisma.serviceOrder.findFirst({
      where: { id: input.serviceOrderId, companyId: input.companyId },
      select: { equipment: { select: { modelo: true } } },
    });
    if (!os) throw new NotFoundException('OS não encontrada.');

    const plano = await this.prisma.planoPreventivo.findFirst({
      where: { companyId: input.companyId, modelo: os.equipment?.modelo ?? 'Geral' },
      select: { categorias: true },
    });
    const brutos = itensDeTrocaDoCiclo(
      plano?.categorias, input.categoriaPlanoId, input.cicloId,
    );
    if (brutos.length === 0) return [];

    const catalogo = await this.prisma.peca.findMany({
      where: { companyId: input.companyId, ativo: true },
      select: { id: true, codigoInterno: true, codigoFabricante: true },
    });
    // `ItemDeTroca.pecaId`/`codigoPeca` são `string | null`; `resolverPeca`
    // (regras/plano-pecas.ts, não alterado) pede `string | undefined` — o
    // brief passava `i` direto e não compila sob `strictNullChecks` (só não
    // pega no `jest` porque `isolatedModules: true` no tsconfig desliga o
    // type-check ali). `texto()` trata `null` e `undefined` da mesma forma
    // (`typeof v === 'string' ? … : ''`), então a conversão é só de tipo.
    return brutos.map((i) => ({
      ...i,
      pecaId: resolverPeca(
        { pecaId: i.pecaId ?? undefined, codigoPeca: i.codigoPeca ?? undefined },
        catalogo,
      ),
    }));
  }

  /**
   * `REQ-2026-001`. Mesma geração do protocolo de OS: MAX+1 por empresa, e o
   * unique de `(company_id, numero)` absorve a concorrência.
   */
  private async proximoNumeroRequisicao(
    tx: Prisma.TransactionClient,
    companyId: string,
  ): Promise<string> {
    const prefixo = `REQ-${new Date().getUTCFullYear()}-`;
    const ultima = await tx.requisicaoMaterial.findFirst({
      where: { companyId, numero: { startsWith: prefixo } },
      orderBy: { numero: 'desc' },
      select: { numero: true },
    });
    const n = ultima ? Number(ultima.numero.replace(prefixo, '')) + 1 : 1;
    return `${prefixo}${String(Number.isFinite(n) ? n : 1).padStart(3, '0')}`;
  }

  /**
   * Entrada de peça no depósito.
   *
   * Movimento e saldo na MESMA transação: gravar um sem o outro é o começo de um
   * estoque que não bate, e o CHECK de `saldo_fisico >= 0` é a rede, não a regra.
   *
   * `custoUnit` nulo mantém o custo médio: devolução de sobra volta sem nota, e
   * tratá-la como entrada a custo zero achataria o valor do estoque.
   */
  async darEntrada(input: {
    companyId: string;
    pecaId: string;
    depositoId: string;
    quantidade: number;
    custoUnit: number | null;
    autorCompanyUserId: string;
    observacao?: string | null;
  }): Promise<{ saldoFisico: number; custoMedio: number }> {
    if (input.quantidade <= 0) {
      throw new BadRequestException('Quantidade tem de ser maior que zero.');
    }

    return this.prisma.$transaction(async (tx) => {
      // Trava a linha antes de ler: duas entradas simultâneas da mesma peça
      // somariam sobre o mesmo saldo lido e uma das duas sumiria.
      const linhas = await tx.$queryRaw<{ saldo_fisico: string }[]>(Prisma.sql`
        SELECT saldo_fisico FROM peca_saldos
         WHERE peca_id = ${input.pecaId}::uuid
           AND deposito_id = ${input.depositoId}::uuid
           FOR UPDATE
      `);

      const anterior = linhas[0] ? Number(linhas[0].saldo_fisico) : 0;
      const depois = anterior + input.quantidade;

      const peca = await tx.peca.findFirstOrThrow({
        where: { id: input.pecaId, companyId: input.companyId },
        select: { custoMedio: true },
      });
      const custoMedio = novoCustoMedio(
        Number(peca.custoMedio), anterior, input.quantidade, input.custoUnit,
      );

      await tx.pecaSaldo.upsert({
        where: { pecaId_depositoId: { pecaId: input.pecaId, depositoId: input.depositoId } },
        create: { pecaId: input.pecaId, depositoId: input.depositoId, saldoFisico: depois },
        update: { saldoFisico: depois },
      });
      await tx.peca.update({
        where: { id: input.pecaId },
        data: { custoMedio },
      });
      await tx.estoqueMovimento.create({
        data: {
          companyId: input.companyId,
          pecaId: input.pecaId,
          depositoId: input.depositoId,
          tipo: 'entrada',
          quantidade: input.quantidade,
          saldoApos: depois,
          custoUnit: input.custoUnit,
          origemTipo: 'ajuste_manual',
          autorCompanyUserId: input.autorCompanyUserId,
          observacao: input.observacao ?? null,
        },
      });

      return { saldoFisico: depois, custoMedio };
    });
  }
}
