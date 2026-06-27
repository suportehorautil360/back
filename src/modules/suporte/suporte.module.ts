import { Module } from '@nestjs/common';
import { FirebaseService } from '../../config/firebase.service';
import { AdminSecretGuard } from '../whatsapp/admin-secret.guard';
import { SuporteController } from './suporte.controller';
import { SuporteService } from './suporte.service';

@Module({
  controllers: [SuporteController],
  providers: [SuporteService, FirebaseService, AdminSecretGuard],
  exports: [SuporteService],
})
export class SuporteModule {}
