import { Module } from '@nestjs/common';
import { VehiclesController } from './vehicles.controller';
import { VehiclesService } from './vehicles.service';
import { FirebaseService } from '../services/firebase.service';

@Module({
  controllers: [VehiclesController],
  providers: [VehiclesService, FirebaseService],
})
export class VehiclesModule {}
