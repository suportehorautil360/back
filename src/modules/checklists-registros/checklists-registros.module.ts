import { Module } from '@nestjs/common';
import { ChecklistsRegistrosController } from './checklists-registros.controller';
import { ChecklistsRegistrosService } from './checklists-registros.service';

@Module({
  controllers: [ChecklistsRegistrosController],
  providers: [ChecklistsRegistrosService],
  exports: [ChecklistsRegistrosService],
})
export class ChecklistsRegistrosModule {}
