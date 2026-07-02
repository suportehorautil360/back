import { Module } from '@nestjs/common';
import { FirebaseService } from '../../config/firebase.service';
import { EquipamentosModule } from '../equipamentos/equipamentos.module';
import { ChecklistChegadaController } from './checklist-chegada.controller';
import { ChecklistChegadaService } from './checklist-chegada.service';

@Module({
  imports: [EquipamentosModule],
  controllers: [ChecklistChegadaController],
  providers: [ChecklistChegadaService, FirebaseService],
  exports: [ChecklistChegadaService],
})
export class ChecklistChegadaModule {}
