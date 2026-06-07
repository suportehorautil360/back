import { Module } from '@nestjs/common';
import { FirebaseService } from '../../../config/firebase.service';
import { ConsumoCustoController } from './consumo-custo.controller';
import { ConsumoCustoService } from './consumo-custo.service';

@Module({
  controllers: [ConsumoCustoController],
  providers: [ConsumoCustoService, FirebaseService],
  exports: [ConsumoCustoService],
})
export class ConsumoCustoModule {}
