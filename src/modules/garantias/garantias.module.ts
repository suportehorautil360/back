import { Module } from '@nestjs/common';
import { FirebaseService } from '../../config/firebase.service';
import { GarantiasController } from './garantias.controller';
import { GarantiasService } from './garantias.service';

@Module({
  controllers: [GarantiasController],
  providers: [GarantiasService, FirebaseService],
  exports: [GarantiasService],
})
export class GarantiasModule {}
