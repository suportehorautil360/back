import { Module } from '@nestjs/common';
import { FirebaseService } from '../../config/firebase.service';
import { OficinasController } from './oficinas.controller';
import { OficinasService } from './oficinas.service';

@Module({
  controllers: [OficinasController],
  providers: [OficinasService, FirebaseService],
  exports: [OficinasService],
})
export class OficinasModule {}
