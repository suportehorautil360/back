import { Module } from '@nestjs/common';
import { OficinasController } from './oficinas.controller';
import { OficinasService } from './oficinas.service';

@Module({
  controllers: [OficinasController],
  providers: [OficinasService],
  exports: [OficinasService],
})
export class OficinasModule {}
