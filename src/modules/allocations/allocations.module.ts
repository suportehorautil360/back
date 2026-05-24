import { Module } from '@nestjs/common';

import { FirebaseService } from 'src/config/firebase.service';
import { AllocationsService } from './allocations.service';
import { AllocationsController } from './allocations.controller';
import { WorkFrontModule } from '../work-front/work-front.module';

@Module({
  imports: [WorkFrontModule],
  controllers: [AllocationsController],
  providers: [AllocationsService, FirebaseService],
})
export class AllocationsModule {}
