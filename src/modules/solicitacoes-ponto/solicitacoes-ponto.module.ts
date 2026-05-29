import { Module } from '@nestjs/common';
import { SolicitacoesPontoController } from './solicitacoes-ponto.controller';
import { SolicitacoesPontoService } from './solicitacoes-ponto.service';
import { FirebaseService } from '../../config/firebase.service';
import { NotificacoesModule } from '../notificacoes/notificacoes.module';

@Module({
  imports: [NotificacoesModule],
  controllers: [SolicitacoesPontoController],
  providers: [SolicitacoesPontoService, FirebaseService],
})
export class SolicitacoesPontoModule {}
