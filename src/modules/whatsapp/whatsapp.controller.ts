import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { WhatsAppService } from './whatsapp.service';
import { AdminSecretGuard } from './admin-secret.guard';

class EnviarMensagemDto {
  @ApiProperty({ example: '+5567999999999' })
  @IsString()
  numero!: string;

  @ApiProperty()
  @IsString()
  texto!: string;
}

class EnviarImagemDto {
  @ApiProperty({ example: '+5567999999999' })
  @IsString()
  numero!: string;

  @ApiProperty({ description: 'Data URL, base64 ou URL http(s)' })
  @IsString()
  imagem!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  legenda?: string;
}

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

  @Post('enviar-mensagem')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Envia texto para um número (uso interno / serviço remoto)' })
  async enviarMensagem(@Body() dto: EnviarMensagemDto) {
    await this.wa.enviarMensagem(dto.numero, dto.texto);
    return { data: {}, message: 'Mensagem enviada.' };
  }

  @Post('enviar-imagem')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Envia imagem para um número (uso interno / serviço remoto)' })
  async enviarImagem(@Body() dto: EnviarImagemDto) {
    await this.wa.enviarImagem(dto.numero, dto.imagem, dto.legenda);
    return { data: {}, message: 'Imagem enviada.' };
  }

  @Get('overview')
  @ApiOperation({ summary: 'Visão consolidada do Hub WhatsApp (status, KPIs, eventos)' })
  async overview() {
    return { data: await this.wa.getOverview(), message: 'Overview do WhatsApp.' };
  }
}
