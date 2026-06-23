import { Module } from '@nestjs/common';
import { FirebaseService } from '../../config/firebase.service';
import { GarantiasModule } from '../garantias/garantias.module';
import { ChecklistDevolucaoController } from './checklist-devolucao.controller';
import { ChecklistDevolucaoService } from './checklist-devolucao.service';

@Module({
  imports: [GarantiasModule],
  controllers: [ChecklistDevolucaoController],
  providers: [ChecklistDevolucaoService, FirebaseService],
  exports: [ChecklistDevolucaoService],
})
export class ChecklistDevolucaoModule {}
