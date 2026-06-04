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
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { TimeRecordsService } from './time-records.service';
import { CreateTimeRecordDto } from './dto/create-time-record.dto';
import { UpdateTimeRecordDto } from './dto/update-time-record.dto';
import { ReprovarTimeRecordDto } from './dto/reprovar-time-record.dto';

@ApiTags('time-records')
@Controller('time-records')
export class TimeRecordsController {
  constructor(private readonly timeRecordsService: TimeRecordsService) {}

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
