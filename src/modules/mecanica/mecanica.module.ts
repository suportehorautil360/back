import { Module } from '@nestjs/common';
import { MecanicaController } from './mecanica.controller';
import { MecanicaService } from './mecanica.service';

@Module({
  controllers: [MecanicaController],
  providers: [MecanicaService],
  exports: [MecanicaService],
})
export class MecanicaModule {}
