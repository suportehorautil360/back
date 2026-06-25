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
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CreateMensagemSuporteDto } from './dto/create-mensagem.dto';
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
}
