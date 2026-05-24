import { Module } from '@nestjs/common';
import { WorkFrontService } from './work-front.service';
import { WorkFrontController } from './work-front.controller';
import { FirebaseService } from 'src/config/firebase.service';

@Module({
  controllers: [WorkFrontController],
  providers: [WorkFrontService, FirebaseService],
  exports: [WorkFrontService],
})
export class WorkFrontModule {}
