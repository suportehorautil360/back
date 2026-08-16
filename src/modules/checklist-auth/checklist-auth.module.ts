import { Module } from '@nestjs/common';
import { ChecklistChassiService } from './checklist-chassi.service';
import { ChecklistAuthController } from './checklist-auth.controller';

@Module({
  controllers: [ChecklistAuthController],
  providers: [ChecklistChassiService],
  exports: [ChecklistChassiService],
})
export class ChecklistAuthModule {}
