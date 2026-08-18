import { Module } from '@nestjs/common';
import { WorkFrontService } from './work-front.service';
import { WorkFrontController } from './work-front.controller';
import { FirebaseService } from 'src/config/firebase.service';

@Module({
  controllers: [WorkFrontController],
  // FirebaseService mantido só para validar responsável (`users` ainda no Firestore).
  providers: [WorkFrontService, FirebaseService],
  exports: [WorkFrontService],
})
export class WorkFrontModule {}
