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
