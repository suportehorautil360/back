import { Module } from '@nestjs/common';
import { PlanosPreventivosController } from './planos-preventivos.controller';
import { PlanosPreventivosService } from './planos-preventivos.service';

@Module({
  controllers: [PlanosPreventivosController],
  providers: [PlanosPreventivosService],
  exports: [PlanosPreventivosService],
})
export class PlanosPreventivosModule {}
