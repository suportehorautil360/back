import { Module } from '@nestjs/common';
import { SolicitacoesPontoController } from './solicitacoes-ponto.controller';
import { SolicitacoesPontoService } from './solicitacoes-ponto.service';
import { FirebaseService } from '../../config/firebase.service';

@Module({
  controllers: [SolicitacoesPontoController],
  providers: [SolicitacoesPontoService, FirebaseService],
})
export class SolicitacoesPontoModule {}
