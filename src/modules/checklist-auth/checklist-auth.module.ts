import { Module } from '@nestjs/common';
import { FirebaseService } from '../../config/firebase.service';
import { ChecklistChassiService } from './checklist-chassi.service';

@Module({
  providers: [FirebaseService, ChecklistChassiService],
  exports: [ChecklistChassiService],
})
export class ChecklistAuthModule {}
