import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { AdminSecretGuard } from '../whatsapp/admin-secret.guard';
import { AlertasController } from './alertas.controller';
import { AlertasService } from './alertas.service';

/**
 * Alertas operacionais (revisão vencida, CNH a vencer, tanque crítico).
 * Varredura diária por cron + endpoints de prévia/disparo manual. Envia email
 * pro `emailAlertas` da prefeitura via Resend.
 */
@Module({
  imports: [MailModule],
  controllers: [AlertasController],
  providers: [AlertasService, AdminSecretGuard],
})
export class AlertasModule {}
