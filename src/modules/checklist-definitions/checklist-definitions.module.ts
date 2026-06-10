import { Module } from '@nestjs/common';
import { FirebaseService } from '../../config/firebase.service';
import { ChecklistDefinitionsController } from './checklist-definitions.controller';
import { ChecklistDefinitionsService } from './checklist-definitions.service';

@Module({
  controllers: [ChecklistDefinitionsController],
  providers: [ChecklistDefinitionsService, FirebaseService],
})
export class ChecklistDefinitionsModule {}
