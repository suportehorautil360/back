import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ChecklistDevolucaoService } from './checklist-devolucao.service';
import { ConferirChecklistDevolucaoDto } from './dto/conferir-checklist-devolucao.dto';
import { buildChdCreateResponseFields } from './helpers/chd-response.helper';
import { countPartsHintInRawBody } from './helpers/normalize-chd-payload.helper';

@ApiTags('checklist-devolucao (CHD)')
@Controller(['checklist-devolucao', 'chd'])
export class ChecklistDevolucaoController {
  constructor(private readonly service: ChecklistDevolucaoService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Registrar checklist de devolução (CHD)',
    description:
      'Grava em checklistsDevolucao. O protocolo da O.S. (identification.os) vem do front — ' +
      'referência a uma OS já existente; o back só gera number CHD-{ano}-{seq} do checklist. ' +
      'Fotos devem ser URLs (upload prévio via POST /uploads/foto com checklistId). ' +
      'Fluxo: 1) gerar id → 2) uploads → 3) POST aqui → 4) PATCH /:id/fotos se necessário.',
  })
  @ApiResponse({ status: 201, description: 'Checklist salvo.' })
  async criar(@Body() body: unknown) {
    const partsHint = countPartsHintInRawBody(body);
    const data = await this.service.criar(body);
    const fields = buildChdCreateResponseFields(data, partsHint);

    return {
      data,
      partsCount: data.parts.items.length,
      servicesCount: data.services.items.length,
      fields,
      message:
        data.parts.items.length > 0
          ? `Checklist de devolução registrado com ${data.parts.items.length} peça(s).`
          : 'Checklist de devolução registrado (sem peças no payload recebido).',
    };
  }

  @Patch(':id/fotos')
  @ApiOperation({
    summary: 'Atualizar URLs de fotos após upload',
    description:
      'Atualiza generalState (anomalias) e/ou parts (newPhoto, replacedPhoto).',
  })
  async atualizarFotos(
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const data = await this.service.atualizarFotos(id, body);
    return {
      data,
      message: 'Fotos do checklist de devolução atualizadas com sucesso.',
    };
  }

  @Patch(':id/conferir')
  @ApiOperation({
    summary: 'Prefeitura confere a devolução',
    description:
      'Se aceito: gera registros em garantias (peças + serviços do CHD), ' +
      'status do CHD → aceito e solicitacaoOS → concluido. Se contestado: status → contestado.',
  })
  async conferir(
    @Param('id') id: string,
    @Body() dto: ConferirChecklistDevolucaoDto,
  ) {
    return this.service.conferir(id, dto);
  }

  @Get('oficina/:oficinaId')
  @ApiOperation({ summary: 'Listar CHDs enviados pela oficina' })
  @ApiParam({ name: 'oficinaId' })
  listarPorOficina(@Param('oficinaId') oficinaId: string) {
    return this.service.listarPorOficina(oficinaId);
  }

  @Get('prefeitura/:prefeituraId')
  @ApiOperation({ summary: 'Listar CHDs recebidos pela prefeitura' })
  @ApiParam({ name: 'prefeituraId' })
  listarPorPrefeitura(@Param('prefeituraId') prefeituraId: string) {
    return this.service.listarPorPrefeitura(prefeituraId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obter checklist de devolução por id' })
  @ApiParam({ name: 'id' })
  async obter(@Param('id') id: string) {
    const data = await this.service.obter(id);
    return {
      data,
      message: 'Checklist de devolução encontrado.',
    };
  }
}
