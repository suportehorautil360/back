import { Module } from '@nestjs/common';
import { FirebaseService } from '../../config/firebase.service';
import { SuporteController } from './suporte.controller';
import { SuporteService } from './suporte.service';

@Module({
  controllers: [SuporteController],
  providers: [SuporteService, FirebaseService],
  exports: [SuporteService],
})
export class SuporteModule {}
