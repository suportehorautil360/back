import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { varrerEstoqueMinimo } from './estoque-minimo';

/**
 * A varredura diária do estoque mínimo. Pega o que nenhum ato disparou: mínimo
 * que alguém subiu no cadastro, reposição cancelada que liberou a vaga, ou uma
 * verificação que falhou e virou log.
 *
 * Fuso explícito: sem `timeZone` o cron segue o fuso do processo, que nada
 * garante ser o de Brasília.
 *
 * Mais de uma instância do back rodando o mesmo cron não duplica solicitação:
 * cada verificação trava a linha de saldo e relê, e o índice único parcial
 * `solicitacao_compra_itens_uma_reposicao_automatica` é a rede.
 */
@Injectable()
export class EstoqueMinimoAgendador {
  private readonly logger = new Logger(EstoqueMinimoAgendador.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron('0 7 * * *', { timeZone: 'America/Sao_Paulo' })
  async varrerDiariamente(): Promise<void> {
    try {
      const r = await varrerEstoqueMinimo(this.prisma);
      this.logger.log(
        `Estoque mínimo: ${r.empresas} empresa(s), ${r.verificados} peça(s) por depósito verificada(s), ` +
          `${r.criadas} solicitação(ões) criada(s), ${r.falhas} falha(s).`,
      );
    } catch (erro) {
      this.logger.error(
        'Falha na varredura diária de estoque mínimo',
        erro instanceof Error ? erro.stack : String(erro),
      );
    }
  }
}
