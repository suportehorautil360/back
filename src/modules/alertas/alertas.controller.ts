import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiOkResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AdminSecretGuard } from '../whatsapp/admin-secret.guard';
import { AlertasService } from './alertas.service';

@ApiTags('alertas')
@Controller('alertas')
@UseGuards(AdminSecretGuard)
@ApiSecurity('x-admin-secret')
export class AlertasController {
  constructor(private readonly alertas: AlertasService) {}

  @Get('preview/:prefeituraId')
  @ApiOperation({
    summary: 'Prévia dos alertas de uma prefeitura (sem enviar email).',
  })
  @ApiOkResponse({ description: 'Achados de revisão, CNH e tanque.' })
  async preview(@Param('prefeituraId') prefeituraId: string) {
    const data = await this.alertas.coletar(prefeituraId, {
      revisao: true,
      cnh: true,
      tanque: true,
    });
    return { data, message: 'Prévia dos alertas (sem enviar).' };
  }

  @Post('run')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Roda a varredura de alertas agora e dispara os emails.',
  })
  @ApiOkResponse({ description: 'Resumo da varredura.' })
  async run() {
    const data = await this.alertas.varrer();
    return { data, message: 'Varredura executada.' };
  }
}
