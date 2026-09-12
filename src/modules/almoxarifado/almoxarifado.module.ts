import { Module } from '@nestjs/common';
import { AlmoxarifadoController } from './almoxarifado.controller';
import { AlmoxarifadoService } from './almoxarifado.service';

@Module({
  controllers: [AlmoxarifadoController],
  providers: [AlmoxarifadoService],
  exports: [AlmoxarifadoService],
})
export class AlmoxarifadoModule {}
