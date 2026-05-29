import { Module } from '@nestjs/common';
import { FirebaseService } from '../../config/firebase.service';
import { EmergenciesController } from './emergencies.controller';
import { EmergenciesService } from './emergencies.service';

@Module({
  controllers: [EmergenciesController],
  providers: [EmergenciesService, FirebaseService],
  exports: [EmergenciesService],
})
export class EmergenciesModule {}
