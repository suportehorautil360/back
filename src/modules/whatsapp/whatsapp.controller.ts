import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { WhatsAppService } from './whatsapp.service';
import { AdminSecretGuard } from './admin-secret.guard';

@ApiTags('whatsapp')
@Controller('whatsapp')
@UseGuards(AdminSecretGuard)
export class WhatsAppController {
  constructor(private readonly wa: WhatsAppService) {}

  @Get('status')
  @ApiOperation({ summary: 'Status da conexão WhatsApp (+ QR quando aguardando)' })
  async status() {
    return { data: await this.wa.getStatus(), message: 'Status do WhatsApp.' };
  }

  @Post('connect')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Inicia a conexão WhatsApp (gera o QR para parear)' })
  async connect() {
    await this.wa.connect();
    return { data: await this.wa.getStatus(), message: 'Conectando…' };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Desconecta e encerra a sessão WhatsApp' })
  async logout() {
    await this.wa.logout();
    return { data: {}, message: 'WhatsApp desconectado.' };
  }

  @Post('enviar-teste')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Envia uma mensagem de teste para um número' })
  async enviarTeste(@Body() dto: { numero: string }) {
    await this.wa.enviarMensagem(
      dto.numero,
      'Teste de notificação — Hora Útil 360 ✅',
    );
    return { data: {}, message: 'Mensagem de teste enviada.' };
  }
}
