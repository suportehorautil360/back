import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { NotificacoesModule } from '../notificacoes/notificacoes.module';
import { OrcamentosController } from './orcamentos/orcamentos.controller';
import { OrcamentosService } from './orcamentos/orcamentos.service';
import { SolicitacoesController } from './solicitacoes/solicitacoes.controller';
import { SolicitacoesService } from './solicitacoes/solicitacoes.service';

@Module({
  imports: [JwtModule.register({}), NotificacoesModule],
  controllers: [SolicitacoesController, OrcamentosController],
  providers: [JwtAuthGuard, SolicitacoesService, OrcamentosService],
  exports: [SolicitacoesService, OrcamentosService],
})
export class OsModule {}
