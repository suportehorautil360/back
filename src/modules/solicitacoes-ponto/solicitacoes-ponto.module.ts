import { Module } from '@nestjs/common';
import { SolicitacoesPontoController } from './solicitacoes-ponto.controller';
import { SolicitacoesPontoService } from './solicitacoes-ponto.service';
import { FirebaseService } from '../../config/firebase.service';
import { NotificacoesModule } from '../notificacoes/notificacoes.module';
import { AbonosModule } from '../abonos/abonos.module';

@Module({
  imports: [NotificacoesModule, AbonosModule],
  controllers: [SolicitacoesPontoController],
  providers: [SolicitacoesPontoService, FirebaseService],
})
export class SolicitacoesPontoModule {}
