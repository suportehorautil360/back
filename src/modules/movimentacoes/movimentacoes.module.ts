import { Module } from '@nestjs/common';
import { AbastecimentosModule } from './abastecimentos/abastecimentos.module';
import { HistoricoModule } from './historico/historico.module';
import { LubrificacoesModule } from './lubrificacoes/lubrificacoes.module';
import { ReabastecimentoModule } from './reabastecimento/reabastecimento.module';
import { MovimentacoesController } from './movimentacoes.controller';
import { MovimentacoesService } from './movimentacoes.service';

@Module({
  imports: [
    AbastecimentosModule,
    HistoricoModule,
    LubrificacoesModule,
    ReabastecimentoModule,
  ],
  controllers: [MovimentacoesController],
  providers: [MovimentacoesService],
  exports: [MovimentacoesService],
})
export class MovimentacoesModule {}
