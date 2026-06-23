import { Module } from '@nestjs/common';
import { FirebaseService } from '../../config/firebase.service';
import { OrcamentosController } from './orcamentos/orcamentos.controller';
import { OrcamentosService } from './orcamentos/orcamentos.service';
import { SolicitacoesController } from './solicitacoes/solicitacoes.controller';
import { SolicitacoesService } from './solicitacoes/solicitacoes.service';

@Module({
  controllers: [SolicitacoesController, OrcamentosController],
  providers: [SolicitacoesService, OrcamentosService, FirebaseService],
  exports: [SolicitacoesService, OrcamentosService],
})
export class OsModule {}
