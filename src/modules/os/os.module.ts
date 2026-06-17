import { Module } from '@nestjs/common';
import { FirebaseService } from '../../config/firebase.service';
import { SolicitacoesController } from './solicitacoes/solicitacoes.controller';
import { SolicitacoesService } from './solicitacoes/solicitacoes.service';

@Module({
  controllers: [SolicitacoesController],
  providers: [SolicitacoesService, FirebaseService],
  exports: [SolicitacoesService],
})
export class OsModule {}
