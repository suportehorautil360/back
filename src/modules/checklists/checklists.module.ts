import { Module } from '@nestjs/common';
import { EmergenciesModule } from '../emergencies/emergencies.module';
import { ChecklistFlowService } from './checklist-flow.service';
import { ChecklistsController } from './checklists.controller';
import { ChecklistsService } from './checklists.service';

@Module({
  imports: [EmergenciesModule],
  controllers: [ChecklistsController],
  providers: [ChecklistsService, ChecklistFlowService],
})
export class ChecklistsModule {}
