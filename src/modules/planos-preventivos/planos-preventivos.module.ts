import { Module } from '@nestjs/common';
import { FirebaseService } from '../../config/firebase.service';
import { PlanosPreventivosController } from './planos-preventivos.controller';
import { PlanosPreventivosService } from './planos-preventivos.service';

@Module({
  controllers: [PlanosPreventivosController],
  providers: [PlanosPreventivosService, FirebaseService],
  exports: [PlanosPreventivosService],
})
export class PlanosPreventivosModule {}
