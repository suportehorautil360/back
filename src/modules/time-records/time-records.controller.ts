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
import {
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { TimeRecordsService } from './time-records.service';
import { AfdService } from './afd.service';
import { CreateTimeRecordDto } from './dto/create-time-record.dto';
import { UpdateTimeRecordDto } from './dto/update-time-record.dto';
import { ReprovarTimeRecordDto } from './dto/reprovar-time-record.dto';

@ApiTags('time-records')
@Controller('time-records')
export class TimeRecordsController {
  constructor(
    private readonly timeRecordsService: TimeRecordsService,
    private readonly afdService: AfdService,
  ) {}

  @Get('afd/:prefeituraId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Gerar o AFD (Arquivo Fonte de Dados) da prefeitura — Portaria 671',
  })
  @ApiParam({ name: 'prefeituraId', description: 'ID da prefeitura' })
  @ApiQuery({ name: 'de', required: false, description: 'Data inicial YYYY-MM-DD' })
  @ApiQuery({ name: 'ate', required: false, description: 'Data final YYYY-MM-DD' })
  @ApiOkResponse({ description: 'AFD gerado (conteúdo + nome do arquivo).' })
  async gerarAfd(
    @Param('prefeituraId') prefeituraId: string,
    @Query('de') de?: string,
    @Query('ate') ate?: string,
  ) {
    const r = await this.afdService.gerar(prefeituraId, de, ate);
    return { data: r, message: 'AFD gerado com sucesso!' };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Registrar uma batida de ponto (com foto)' })
  @ApiInternalServerErrorResponse({
    description: 'Falha ao registrar o ponto.',
  })
  async create(@Body() dto: CreateTimeRecordDto) {
    return this.timeRecordsService.create(dto);
  }

  @Post('update/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Solicitar correção de horário (cria um ajuste; não altera a batida original)',
  })
  @ApiParam({ name: 'id', description: 'ID da batida original' })
  @ApiOkResponse({ description: 'Ajuste de correção registrado.' })
  @ApiInternalServerErrorResponse({
    description: 'Falha ao registrar a correção.',
  })
  async update(@Param('id') id: string, @Body() dto: UpdateTimeRecordDto) {
    return this.timeRecordsService.update(id, dto);
  }

  @Post(':id/aprovar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Aprovar um AJUSTE/cancelamento de ponto, aplicando-o à folha (RH)',
  })
  @ApiParam({ name: 'id', description: 'ID do registro de ajuste/cancelamento' })
  @ApiOkResponse({ description: 'Ajuste aplicado.' })
  @ApiInternalServerErrorResponse({ description: 'Falha ao aprovar o ajuste.' })
  async aprovar(@Param('id') id: string) {
    return this.timeRecordsService.aprovar(id);
  }

  @Post(':id/reprovar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reprovar um AJUSTE/cancelamento de ponto, com motivo (RH)',
  })
  @ApiParam({ name: 'id', description: 'ID do registro de ajuste/cancelamento' })
  @ApiOkResponse({ description: 'Ajuste reprovado.' })
  @ApiInternalServerErrorResponse({
    description: 'Falha ao reprovar o ajuste.',
  })
  async reprovar(@Param('id') id: string, @Body() dto: ReprovarTimeRecordDto) {
    return this.timeRecordsService.reprovar(id, dto.motivo);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar batidas de ponto por prefeitura' })
  @ApiParam({ name: 'id', description: 'ID da prefeitura' })
  @ApiOkResponse({ description: 'Lista de batidas (pode ser vazia).' })
  @ApiInternalServerErrorResponse({ description: 'Falha ao buscar os pontos.' })
  async findAllById(@Param('id') id: string) {
    return this.timeRecordsService.findAllById(id);
  }
}
