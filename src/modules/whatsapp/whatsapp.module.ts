import { Module } from '@nestjs/common';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppMetricsService } from './whatsapp-metrics.service';
import { AdminSecretGuard } from './admin-secret.guard';
import { FirebaseService } from '../../config/firebase.service';

import { WhatsAppEvolutionClient } from './whatsapp-evolution.client';
import { WhatsAppRemoteClient } from './whatsapp-remote.client';

@Module({
  controllers: [WhatsAppController],
  providers: [
    WhatsAppService,
    WhatsAppEvolutionClient,
    WhatsAppRemoteClient,
    WhatsAppMetricsService,
    AdminSecretGuard,
    FirebaseService,
  ],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}
