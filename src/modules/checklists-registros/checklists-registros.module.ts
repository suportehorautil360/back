import { Module } from '@nestjs/common';
import { FirebaseService } from '../../config/firebase.service';
import { ChecklistsRegistrosController } from './checklists-registros.controller';
import { ChecklistsRegistrosService } from './checklists-registros.service';

@Module({
  controllers: [ChecklistsRegistrosController],
  providers: [ChecklistsRegistrosService, FirebaseService],
  exports: [ChecklistsRegistrosService],
})
export class ChecklistsRegistrosModule {}
