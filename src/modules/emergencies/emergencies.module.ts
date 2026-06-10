import { Module } from '@nestjs/common';
import { FirebaseService } from '../../config/firebase.service';
import { EmergenciesController } from './emergencies.controller';
import { EmergenciesService } from './emergencies.service';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [WhatsAppModule, MailModule],
  controllers: [EmergenciesController],
  providers: [EmergenciesService, FirebaseService],
  exports: [EmergenciesService],
})
export class EmergenciesModule {}
