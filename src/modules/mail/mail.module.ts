import { Module } from '@nestjs/common';
import { MailController } from './mail.controller';
import { MailService } from './mail.service';
import { AdminSecretGuard } from '../whatsapp/admin-secret.guard';

/**
 * Envio de email transacional via Resend. Exporta o MailService para outros
 * módulos plugarem gatilhos (relatório semanal, alertas, ponto, etc.).
 */
@Module({
  controllers: [MailController],
  providers: [MailService, AdminSecretGuard],
  exports: [MailService],
})
export class MailModule {}
