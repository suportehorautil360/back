import { Module } from '@nestjs/common';
import { ConsumoCustoController } from './consumo-custo.controller';
import { ConsumoCustoService } from './consumo-custo.service';

@Module({
  controllers: [ConsumoCustoController],
  providers: [ConsumoCustoService],
  exports: [ConsumoCustoService],
})
export class ConsumoCustoModule {}
