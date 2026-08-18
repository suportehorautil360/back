import { Module } from '@nestjs/common';
import { InsumosController } from './insumos.controller';
import { InsumosService } from './insumos.service';

@Module({
  controllers: [InsumosController],
  providers: [InsumosService],
})
export class InsumosModule {}
