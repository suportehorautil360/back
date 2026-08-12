import { Module } from '@nestjs/common';
import { FirebaseService } from '../../config/firebase.service';
import { ChecklistChassiService } from './checklist-chassi.service';
import { ChecklistAuthController } from './checklist-auth.controller';

@Module({
  controllers: [ChecklistAuthController],
  providers: [FirebaseService, ChecklistChassiService],
  exports: [ChecklistChassiService],
})
export class ChecklistAuthModule {}
