import { Module } from '@nestjs/common';
import { FeatureFlagsController } from './feature-flags.controller';
import { FeatureFlagsService } from './feature-flags.service';
import { FirebaseService } from '../../config/firebase.service';

@Module({
  controllers: [FeatureFlagsController],
  providers: [FeatureFlagsService, FirebaseService],
  exports: [FeatureFlagsService],
})
export class FeatureFlagsModule {}
