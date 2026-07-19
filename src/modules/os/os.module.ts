import { Module } from '@nestjs/common';
import { FirebaseService } from '../../config/firebase.service';
import { NotificacoesModule } from '../notificacoes/notificacoes.module';
import { OrcamentosController } from './orcamentos/orcamentos.controller';
import { OrcamentosService } from './orcamentos/orcamentos.service';
import { SolicitacoesController } from './solicitacoes/solicitacoes.controller';
import { SolicitacoesService } from './solicitacoes/solicitacoes.service';

@Module({
  imports: [NotificacoesModule],
  controllers: [SolicitacoesController, OrcamentosController],
  providers: [SolicitacoesService, OrcamentosService, FirebaseService],
  exports: [SolicitacoesService, OrcamentosService],
})
export class OsModule {}
