import { Module } from '@nestjs/common';
import { TimeRecordsController } from './time-records.controller';
import { TimeRecordsService } from './time-records.service';
import { FirebaseService } from '../../config/firebase.service';

@Module({
  controllers: [TimeRecordsController],
  providers: [TimeRecordsService, FirebaseService],
})
export class TimeRecordsModule {}
