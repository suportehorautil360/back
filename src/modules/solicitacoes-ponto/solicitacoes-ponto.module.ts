import { Module } from '@nestjs/common';
import { IdempotencyInterceptor } from '../../common/idempotency.interceptor';
import { SolicitacoesPontoController } from './solicitacoes-ponto.controller';
import { SolicitacoesPontoService } from './solicitacoes-ponto.service';
import { NotificacoesModule } from '../notificacoes/notificacoes.module';
import { AbonosModule } from '../abonos/abonos.module';

@Module({
  imports: [NotificacoesModule, AbonosModule],
  controllers: [SolicitacoesPontoController],
  providers: [SolicitacoesPontoService, IdempotencyInterceptor],
})
export class SolicitacoesPontoModule {}
