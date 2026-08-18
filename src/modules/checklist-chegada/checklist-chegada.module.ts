import { Module } from '@nestjs/common';
import { EquipamentosModule } from '../equipamentos/equipamentos.module';
import { ChecklistChegadaController } from './checklist-chegada.controller';
import { ChecklistChegadaService } from './checklist-chegada.service';

@Module({
  imports: [EquipamentosModule],
  controllers: [ChecklistChegadaController],
  providers: [ChecklistChegadaService],
  exports: [ChecklistChegadaService],
})
export class ChecklistChegadaModule {}
