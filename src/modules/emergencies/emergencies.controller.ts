import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CreateEmergencyDto } from './dto/create-emergency.dto';
import { UpdateEmergencyStatusDto } from './dto/update-emergency-status.dto';
import {
  EmergenciesService,
  type DadosEmergenciaWhats,
} from './emergencies.service';

@ApiTags('emergencies')
@Controller('emergencies')
export class EmergenciesController {
  constructor(private readonly service: EmergenciesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Registrar emergência manual ou automática' })
  async create(@Body() dto: CreateEmergencyDto) {
    return this.service.create(dto);
  }

  @Post('notificar-whatsapp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Dispara a notificação de WhatsApp de uma emergência (best-effort). ' +
      'Usado pelo checklist, que grava a emergência direto no Firestore.',
  })
  async notificarWhatsApp(@Body() dto: DadosEmergenciaWhats) {
    await this.service.notificarWhatsApp(dto);
    return { data: {}, message: 'Notificação de WhatsApp processada.' };
  }

  @Post('notificar-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Dispara a notificação por EMAIL de uma emergência (best-effort). ' +
      'Vai para o email da frente alocada + emailAlertas da empresa. ' +
      'Usado pelo checklist, que grava a emergência direto no Firestore.',
  })
  async notificarEmail(@Body() dto: DadosEmergenciaWhats) {
    await this.service.notificarEmail(dto);
    return { data: {}, message: 'Notificação por email processada.' };
  }

  @Get(':prefeituraId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar emergências por prefeitura' })
  @ApiParam({ name: 'prefeituraId', description: 'ID da prefeitura' })
  @ApiQuery({
    name: 'date',
    required: false,
    description: 'Filtrar por data (ex.: 2026-05-31 ou 31/05/2026).',
  })
  @ApiQuery({
    name: 'chassis',
    required: false,
    description: 'Filtrar por chassis (busca parcial, case-insensitive).',
  })
  @ApiQuery({
    name: 'operator',
    required: false,
    description: 'Filtrar por operador (busca parcial, case-insensitive).',
  })
  async listByPrefeitura(
    @Param('prefeituraId') prefeituraId: string,
    @Query('date') date?: string,
    @Query('chassis') chassis?: string,
    @Query('operator') operator?: string,
  ) {
    return this.service.listByPrefeitura(prefeituraId, {
      date,
      chassis,
      operator,
    });
  }

  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Atualizar status de atendimento da emergência' })
  @ApiParam({ name: 'id', description: 'ID da emergência' })
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateEmergencyStatusDto,
  ) {
    return this.service.updateStatus(id, dto.status);
  }
}
