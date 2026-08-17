import { Module } from '@nestjs/common';
import { TankController } from './tank.controller';
import { FuelEntriesController } from './entries/fuel-entries.controller';
import { TanksService } from './tanks.service';
import { FuelEntriesService } from './entries/fuel-entries.service';

@Module({
  controllers: [TankController, FuelEntriesController],
  providers: [TanksService, FuelEntriesService],
  exports: [TanksService, FuelEntriesService],
})
export class TankModule {}
