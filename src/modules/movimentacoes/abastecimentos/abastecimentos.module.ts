import { Module } from '@nestjs/common';
import { FirebaseService } from '../../../config/firebase.service';
import { AbastecimentosController } from './abastecimentos.controller';
import { AbastecimentosService } from './abastecimentos.service';

@Module({
  controllers: [AbastecimentosController],
  providers: [AbastecimentosService, FirebaseService],
  exports: [AbastecimentosService],
})
export class AbastecimentosModule {}
