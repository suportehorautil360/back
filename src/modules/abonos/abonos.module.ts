import { Module } from '@nestjs/common';
import { AbonosController } from './abonos.controller';
import { AbonosService } from './abonos.service';
import { FirebaseService } from '../../config/firebase.service';

@Module({
  controllers: [AbonosController],
  providers: [AbonosService, FirebaseService],
  exports: [AbonosService],
})
export class AbonosModule {}
