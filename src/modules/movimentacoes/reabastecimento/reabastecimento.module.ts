import { Module } from '@nestjs/common';
import { FirebaseService } from '../../../config/firebase.service';
import { ReabastecimentoController } from './reabastecimento.controller';
import { ReabastecimentoService } from './reabastecimento.service';

@Module({
  controllers: [ReabastecimentoController],
  providers: [ReabastecimentoService, FirebaseService],
  exports: [ReabastecimentoService],
})
export class ReabastecimentoModule {}
