import { Module } from '@nestjs/common';

import { AllocationsService } from './allocations.service';
import { AllocationsController } from './allocations.controller';
import { WorkFrontModule } from '../work-front/work-front.module';

@Module({
  imports: [WorkFrontModule],
  controllers: [AllocationsController],
  providers: [AllocationsService],
})
export class AllocationsModule {}
