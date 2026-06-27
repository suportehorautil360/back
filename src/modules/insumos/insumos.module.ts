import { Module } from '@nestjs/common';
import { FirebaseService } from '../../config/firebase.service';
import { InsumosController } from './insumos.controller';
import { InsumosService } from './insumos.service';

@Module({
  controllers: [InsumosController],
  providers: [InsumosService, FirebaseService],
  exports: [InsumosService],
})
export class InsumosModule {}
