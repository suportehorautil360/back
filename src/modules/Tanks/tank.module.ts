import { Module } from '@nestjs/common';
import { TankController } from './tank.controller';
import { FuelEntriesController } from './entries/fuel-entries.controller';
import { TanksService } from './tanks.service';
import { FuelEntriesService } from './entries/fuel-entries.service';
import { FirebaseService } from 'src/config/firebase.service';

@Module({
  controllers: [TankController, FuelEntriesController], // Dois controladores
  providers: [TanksService, FuelEntriesService, FirebaseService], // Dois serviços
  exports: [TanksService, FuelEntriesService], // Exporta se outros módulos precisarem
})
export class TankModule {}
