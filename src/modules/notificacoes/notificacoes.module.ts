import { Module } from '@nestjs/common';
import { NotificacoesController } from './notificacoes.controller';
import { NotificacoesService } from './notificacoes.service';
import { FirebaseService } from '../../config/firebase.service';

@Module({
  controllers: [NotificacoesController],
  providers: [NotificacoesService, FirebaseService],
  exports: [NotificacoesService],
})
export class NotificacoesModule {}
