import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiOkResponse,
  ApiTags,
  ApiSecurity,
} from '@nestjs/swagger';
import { AdminSecretGuard } from '../whatsapp/admin-secret.guard';
import { SendTestEmailDto } from './dto/send-test.dto';
import { MailService } from './mail.service';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

@ApiTags('mail')
@Controller('mail')
export class MailController {
  constructor(private readonly mail: MailService) {}

  @Get('status')
  @ApiOperation({ summary: 'Status do serviço de email (Resend).' })
  @ApiOkResponse({ description: 'Indica se o envio está habilitado.' })
  status() {
    return {
      data: {
        habilitado: this.mail.habilitado(),
        remetente: this.mail.remetente(),
      },
      message: 'ok',
    };
  }

  @Post('test')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminSecretGuard)
  @ApiSecurity('x-admin-secret')
  @ApiOperation({ summary: 'Envia um email de teste (valida a integração).' })
  @ApiOkResponse({ description: 'Resultado do envio.' })
  async test(@Body() dto: SendTestEmailDto) {
    const to = (dto.to ?? '').trim();
    if (!EMAIL_RE.test(to)) {
      throw new BadRequestException('Informe um email de destino válido.');
    }
    const subject = dto.subject?.trim() || 'Teste de email — Hora Útil 360';
    const mensagem =
      dto.mensagem?.trim() ||
      'Se você recebeu este email, a integração com o Resend está funcionando.';

    const r = await this.mail.enviar({
      to,
      subject,
      html: `
        <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1f2937">
          <h2 style="margin:0 0 8px;color:#0f2348">Hora Útil 360</h2>
          <p style="margin:0 0 16px;color:#6b7280">Teste de integração de email</p>
          <p style="margin:0 0 16px">${mensagem}</p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0" />
          <p style="font-size:12px;color:#9ca3af;margin:0">
            Email automático enviado pelo back-360- via Resend.
          </p>
        </div>`,
      text: mensagem,
    });

    if (!r.ok) {
      throw new BadRequestException(
        r.erro ?? 'Não foi possível enviar o email.',
      );
    }
    return { data: r, message: 'Email de teste enviado!' };
  }
}
