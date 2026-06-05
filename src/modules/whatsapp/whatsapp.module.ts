import { Module } from '@nestjs/common';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppMetricsService } from './whatsapp-metrics.service';
import { AdminSecretGuard } from './admin-secret.guard';
import { FirebaseService } from '../../config/firebase.service';

@Module({
  controllers: [WhatsAppController],
  providers: [
    WhatsAppService,
    WhatsAppMetricsService,
    AdminSecretGuard,
    FirebaseService,
  ],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}
