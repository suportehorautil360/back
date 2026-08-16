import { Module } from '@nestjs/common';
import { ChecklistDefinitionsController } from './checklist-definitions.controller';
import { ChecklistDefinitionsService } from './checklist-definitions.service';

@Module({
  controllers: [ChecklistDefinitionsController],
  providers: [ChecklistDefinitionsService],
})
export class ChecklistDefinitionsModule {}
