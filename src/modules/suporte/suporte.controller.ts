import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AdminSecretGuard } from '../whatsapp/admin-secret.guard';
import { CreateMensagemSuporteDto } from './dto/create-mensagem.dto';
import { CreateMensagemSuportePostoDto } from './dto/create-mensagem-posto.dto';
import { ResponderSuporteDto } from './dto/responder-suporte.dto';
import { ListMensagensSuporteQueryDto } from './dto/list-mensagens-query.dto';
import { MarcarMensagensLidasDto } from './dto/marcar-lidas.dto';
import { SuporteService } from './suporte.service';

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

function resolveOficinaContext(params: {
  pathOficinaId: string;
  bodyOficinaId?: string;
  headerParceiroId?: string;
  headerPrefeituraId?: string;
  bodyParceiroId?: string;
  bodyPrefeituraId?: string;
}) {
  const oficinaId = texto(params.pathOficinaId) || texto(params.bodyOficinaId);
  if (!oficinaId) {
    throw new BadRequestException('oficinaId inválido.');
  }

  if (
    params.bodyOficinaId &&
    params.pathOficinaId &&
    texto(params.bodyOficinaId) !== texto(params.pathOficinaId)
  ) {
    throw new BadRequestException(
      'oficinaId do path não confere com o enviado no body.',
    );
  }

  return {
    oficinaId,
    parceiroId:
      texto(params.bodyParceiroId) ||
      texto(params.headerParceiroId) ||
      undefined,
    prefeituraId:
      texto(params.bodyPrefeituraId) ||
      texto(params.headerPrefeituraId) ||
      undefined,
  };
}

@ApiTags('suporte')
@Controller('suporte')
export class SuporteController {
  constructor(private readonly service: SuporteService) {}

  @Get('oficina/:oficinaId/mensagens')
  @ApiOperation({ summary: 'Listar mensagens do canal de suporte' })
  @ApiParam({ name: 'oficinaId' })
  @ApiQuery({ name: 'channel', enum: ['financeiro', 'ti'] })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'before', required: false })
  listarMensagens(
    @Param('oficinaId') oficinaId: string,
    @Query() query: ListMensagensSuporteQueryDto,
  ) {
    return this.service.listarMensagens(
      oficinaId,
      query.channel,
      query.limit,
      query.before,
    );
  }

  @Post('oficina/:oficinaId/mensagens')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Enviar mensagem no chat de suporte' })
  @ApiParam({ name: 'oficinaId' })
  @ApiResponse({ status: 201, description: 'Mensagem enviada.' })
  enviarMensagem(
    @Param('oficinaId') pathOficinaId: string,
    @Body() dto: CreateMensagemSuporteDto,
    @Headers('x-parceiro-id') headerParceiroId?: string,
    @Headers('x-prefeitura-id') headerPrefeituraId?: string,
  ) {
    const context = resolveOficinaContext({
      pathOficinaId,
      bodyOficinaId: dto.oficinaId,
      headerParceiroId,
      headerPrefeituraId,
    });

    return this.service.enviarMensagem(context.oficinaId, dto, {
      parceiroId: context.parceiroId,
      prefeituraId: context.prefeituraId,
    });
  }

  @Get('oficina/:oficinaId/resumo')
  @ApiOperation({ summary: 'Resumo de mensagens não lidas por canal' })
  @ApiParam({ name: 'oficinaId' })
  obterResumo(@Param('oficinaId') oficinaId: string) {
    return this.service.obterResumo(oficinaId);
  }

  @Patch('oficina/:oficinaId/mensagens/lidas')
  @ApiOperation({
    summary: 'Marcar mensagens do suporte como lidas no canal',
  })
  @ApiParam({ name: 'oficinaId' })
  marcarLidas(
    @Param('oficinaId') oficinaId: string,
    @Body() dto: MarcarMensagensLidasDto,
  ) {
    return this.service.marcarComoLidas(oficinaId, dto.channel);
  }

  // --- Suporte do posto (posto-web) ---

  @Get('posto/:postoId/mensagens')
  @ApiOperation({ summary: 'Listar mensagens do canal de suporte do posto' })
  @ApiParam({ name: 'postoId' })
  @ApiQuery({ name: 'channel', enum: ['financeiro', 'ti'] })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'before', required: false })
  listarMensagensPosto(
    @Param('postoId') postoId: string,
    @Query() query: ListMensagensSuporteQueryDto,
  ) {
    return this.service.listarMensagensPosto(
      postoId,
      query.channel,
      query.limit,
      query.before,
    );
  }

  @Post('posto/:postoId/mensagens')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Enviar mensagem no chat de suporte do posto' })
  @ApiParam({ name: 'postoId' })
  @ApiResponse({ status: 201, description: 'Mensagem enviada.' })
  enviarMensagemPosto(
    @Param('postoId') pathPostoId: string,
    @Body() dto: CreateMensagemSuportePostoDto,
    @Headers('x-prefeitura-id') headerPrefeituraId?: string,
  ) {
    return this.service.enviarMensagemPosto(pathPostoId, dto, {
      prefeituraId:
        texto(dto.prefeituraId) || texto(headerPrefeituraId) || undefined,
    });
  }

  @Get('posto/:postoId/resumo')
  @ApiOperation({ summary: 'Resumo de mensagens não lidas do posto por canal' })
  @ApiParam({ name: 'postoId' })
  obterResumoPosto(@Param('postoId') postoId: string) {
    return this.service.obterResumoPosto(postoId);
  }

  @Patch('posto/:postoId/mensagens/lidas')
  @ApiOperation({
    summary: 'Marcar mensagens do suporte como lidas no canal (posto)',
  })
  @ApiParam({ name: 'postoId' })
  marcarLidasPosto(
    @Param('postoId') postoId: string,
    @Body() dto: MarcarMensagensLidasDto,
  ) {
    return this.service.marcarComoLidasPosto(postoId, dto.channel);
  }

  // --- Inbox do gestor (web-360) ---

  @Get('prefeitura/:prefeituraId/inbox')
  @ApiOperation({ summary: 'Inbox de mensagens dos postos da prefeitura' })
  @ApiParam({ name: 'prefeituraId' })
  @ApiQuery({ name: 'channel', required: false, enum: ['financeiro', 'ti'] })
  listarInbox(
    @Param('prefeituraId') prefeituraId: string,
    @Query('channel') channel?: string,
  ) {
    return this.service.listarInboxPrefeitura(prefeituraId, channel);
  }

  @Get('prefeitura/:prefeituraId/posto/:postoId/mensagens')
  @ApiOperation({ summary: 'Histórico do chat posto (visão gestor)' })
  @ApiParam({ name: 'prefeituraId' })
  @ApiParam({ name: 'postoId' })
  @ApiQuery({ name: 'channel', enum: ['financeiro', 'ti'] })
  listarMensagensGestor(
    @Param('prefeituraId') prefeituraId: string,
    @Param('postoId') postoId: string,
    @Query() query: ListMensagensSuporteQueryDto,
  ) {
    return this.service.listarMensagensGestor(
      prefeituraId,
      postoId,
      query.channel,
      query.limit,
      query.before,
    );
  }

  @Post('prefeitura/:prefeituraId/posto/:postoId/responder')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Gestor responde mensagem do posto' })
  @ApiParam({ name: 'prefeituraId' })
  @ApiParam({ name: 'postoId' })
  responderGestor(
    @Param('prefeituraId') prefeituraId: string,
    @Param('postoId') postoId: string,
    @Body() dto: ResponderSuporteDto,
  ) {
    return this.service.responderComoGestor(prefeituraId, postoId, dto);
  }

  @Patch('prefeitura/:prefeituraId/posto/:postoId/admin-lidas')
  @ApiOperation({ summary: 'Gestor marca mensagens do operador como lidas' })
  @ApiParam({ name: 'prefeituraId' })
  @ApiParam({ name: 'postoId' })
  marcarLidasAdmin(
    @Param('postoId') postoId: string,
    @Body() dto: MarcarMensagensLidasDto,
  ) {
    return this.service.marcarLidasAdmin(postoId, dto.channel);
  }

  // --- Inbox admin Hora Útil (hub mestre) ---

  @Get('admin/inbox')
  @UseGuards(AdminSecretGuard)
  @ApiSecurity('x-admin-secret')
  @ApiOperation({ summary: 'Inbox global de suporte dos postos (Hora Útil)' })
  @ApiQuery({ name: 'channel', required: false, enum: ['financeiro', 'ti'] })
  listarInboxAdmin(@Query('channel') channel?: string) {
    return this.service.listarInboxAdmin(channel);
  }

  @Get('admin/pendentes')
  @UseGuards(AdminSecretGuard)
  @ApiSecurity('x-admin-secret')
  @ApiOperation({ summary: 'Total de mensagens de postos pendentes de leitura' })
  contarPendentesAdmin() {
    return this.service.contarPendentesAdmin();
  }

  @Get('admin/posto/:postoId/mensagens')
  @UseGuards(AdminSecretGuard)
  @ApiSecurity('x-admin-secret')
  @ApiOperation({ summary: 'Histórico do chat posto (visão admin Hora Útil)' })
  @ApiParam({ name: 'postoId' })
  @ApiQuery({ name: 'channel', enum: ['financeiro', 'ti'] })
  listarMensagensAdmin(
    @Param('postoId') postoId: string,
    @Query() query: ListMensagensSuporteQueryDto,
  ) {
    return this.service.listarMensagensAdmin(
      postoId,
      query.channel,
      query.limit,
      query.before,
    );
  }

  @Post('admin/posto/:postoId/responder')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(AdminSecretGuard)
  @ApiSecurity('x-admin-secret')
  @ApiOperation({ summary: 'Equipe Hora Útil responde mensagem do posto' })
  @ApiParam({ name: 'postoId' })
  responderAdmin(
    @Param('postoId') postoId: string,
    @Body() dto: ResponderSuporteDto,
  ) {
    return this.service.responderComoAdmin(postoId, dto);
  }

  @Patch('admin/posto/:postoId/admin-lidas')
  @UseGuards(AdminSecretGuard)
  @ApiSecurity('x-admin-secret')
  @ApiOperation({ summary: 'Admin marca mensagens do operador como lidas' })
  @ApiParam({ name: 'postoId' })
  marcarLidasAdminHub(
    @Param('postoId') postoId: string,
    @Body() dto: MarcarMensagensLidasDto,
  ) {
    return this.service.marcarLidasAdmin(postoId, dto.channel);
  }
}
