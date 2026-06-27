import { Module } from '@nestjs/common';
import { FirebaseService } from '../../config/firebase.service';
import { OcorrenciasController } from './ocorrencias.controller';
import { OcorrenciasService } from './ocorrencias.service';

@Module({
  controllers: [OcorrenciasController],
  providers: [OcorrenciasService, FirebaseService],
  exports: [OcorrenciasService],
})
export class OcorrenciasModule {}
