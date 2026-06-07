import { Module } from '@nestjs/common';
import { FirebaseService } from '../../../config/firebase.service';
import { LubrificacoesController } from './lubrificacoes.controller';
import { LubrificacoesService } from './lubrificacoes.service';

@Module({
  controllers: [LubrificacoesController],
  providers: [LubrificacoesService, FirebaseService],
  exports: [LubrificacoesService],
})
export class LubrificacoesModule {}
