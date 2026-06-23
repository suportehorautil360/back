import { Module } from '@nestjs/common';
import { FirebaseService } from '../../config/firebase.service';
import { ChecklistChegadaController } from './checklist-chegada.controller';
import { ChecklistChegadaService } from './checklist-chegada.service';

@Module({
  controllers: [ChecklistChegadaController],
  providers: [ChecklistChegadaService, FirebaseService],
  exports: [ChecklistChegadaService],
})
export class ChecklistChegadaModule {}
