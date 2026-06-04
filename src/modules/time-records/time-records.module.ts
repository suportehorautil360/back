import { Module } from '@nestjs/common';
import { TimeRecordsController } from './time-records.controller';
import { TimeRecordsService } from './time-records.service';
import { AfdService } from './afd.service';
import { AejService } from './aej.service';
import { FirebaseService } from '../../config/firebase.service';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';

@Module({
  imports: [FeatureFlagsModule],
  controllers: [TimeRecordsController],
  providers: [TimeRecordsService, AfdService, AejService, FirebaseService],
})
export class TimeRecordsModule {}
