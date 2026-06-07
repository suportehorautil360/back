import { Module } from '@nestjs/common';
import { AbastecimentosModule } from './abastecimentos/abastecimentos.module';
import { CreditosModule } from './creditos/creditos.module';
import { ConsumoCustoModule } from './consumo-custo/consumo-custo.module';
import { HistoricoModule } from './historico/historico.module';
import { LubrificacoesModule } from './lubrificacoes/lubrificacoes.module';
import { PostosModule } from './postos/postos.module';
import { ReabastecimentoModule } from './reabastecimento/reabastecimento.module';
import { MovimentacoesController } from './movimentacoes.controller';
import { MovimentacoesService } from './movimentacoes.service';

@Module({
  imports: [
    AbastecimentosModule,
    HistoricoModule,
    ConsumoCustoModule,
    LubrificacoesModule,
    ReabastecimentoModule,
    PostosModule,
    CreditosModule,
  ],
  controllers: [MovimentacoesController],
  providers: [MovimentacoesService],
  exports: [MovimentacoesService],
})
export class MovimentacoesModule {}
