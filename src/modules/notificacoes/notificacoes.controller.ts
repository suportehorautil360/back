import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { NotificacoesService } from './notificacoes.service';
import { CreateNotificacaoDto } from './dto/create-notificacao.dto';
import type { DestinatarioTipo } from './dto/create-notificacao.dto';

// O tipo do parâmetro de rota fica como string pra evitar TS1272
// (tipos em assinaturas decoradas com isolatedModules + emitDecoratorMetadata).
// O service faz o cast seguro pra DestinatarioTipo.

@ApiTags('notificacoes')
@Controller('notificacoes')
export class NotificacoesController {
  constructor(private readonly service: NotificacoesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Criar notificação (uso interno/manual)' })
  async create(@Body() dto: CreateNotificacaoDto) {
    const doc = await this.service.create(dto);
    return { data: doc, message: 'Notificação criada.' };
  }

  @Get(':destinatarioTipo/:destinatarioId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar notificações por destinatário' })
  @ApiParam({ name: 'destinatarioTipo', enum: ['funcionario', 'rh'] })
  @ApiParam({
    name: 'destinatarioId',
    description: 'CPF (funcionario) ou prefeituraId (rh)',
  })
  @ApiOkResponse({ description: 'Lista de notificações (vazia se nada).' })
  async listar(
    @Param('destinatarioTipo') destinatarioTipo: string,
    @Param('destinatarioId') destinatarioId: string,
  ) {
    return this.service.listar(
      destinatarioTipo as DestinatarioTipo,
      destinatarioId,
    );
  }

  @Post(':id/lida')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Marcar uma notificação como lida' })
  async marcarLida(@Param('id') id: string) {
    return this.service.marcarLida(id);
  }

  @Post('marcar-todas/:destinatarioTipo/:destinatarioId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Marcar todas as notificações não lidas como lidas',
  })
  async marcarTodas(
    @Param('destinatarioTipo') destinatarioTipo: string,
    @Param('destinatarioId') destinatarioId: string,
  ) {
    return this.service.marcarTodasLidas(
      destinatarioTipo as DestinatarioTipo,
      destinatarioId,
    );
  }
}
