import { Module } from '@nestjs/common';
import { ConfiguracoesController } from './configuracoes.controller';
import { ConfiguracoesService } from './configuracoes.service';
import { FirebaseService } from '../../config/firebase.service';

@Module({
  controllers: [ConfiguracoesController],
  providers: [ConfiguracoesService, FirebaseService],
})
export class ConfiguracoesModule {}
