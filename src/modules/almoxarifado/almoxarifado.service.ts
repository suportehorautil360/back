import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizarCodigo } from './regras/codigo';

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
}
