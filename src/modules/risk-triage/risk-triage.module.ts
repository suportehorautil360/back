import { Module } from '@nestjs/common';
import { FirebaseService } from '../../config/firebase.service';
import { RiskTriageController } from './risk-triage.controller';
import { RiskTriageService } from './risk-triage.service';

@Module({
  controllers: [RiskTriageController],
  providers: [RiskTriageService, FirebaseService],
})
export class RiskTriageModule {}
