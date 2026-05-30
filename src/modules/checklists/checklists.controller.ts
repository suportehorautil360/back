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
import { AnswerChecklistQuestionDto } from './dto/answer-checklist-question.dto';
import { CreateChecklistRunDto } from './dto/create-checklist-run.dto';
import { ChecklistsService } from './checklists.service';

@ApiTags('checklists')
@Controller('checklists')
export class ChecklistsController {
  constructor(private readonly service: ChecklistsService) {}

  @Post('runs')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Iniciar uma execução de checklist' })
  async createRun(@Body() dto: CreateChecklistRunDto) {
    return this.service.createRun(dto);
  }

  @Post('runs/:id/answers')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Responder pergunta do checklist e executar regras',
  })
  @ApiParam({ name: 'id', description: 'ID da execução do checklist' })
  async answer(
    @Param('id') id: string,
    @Body() dto: AnswerChecklistQuestionDto,
  ) {
    return this.service.answer(id, dto);
  }

  @Get('runs/prefeitura/:prefeituraId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar execuções de checklist por prefeitura' })
  @ApiParam({ name: 'prefeituraId', description: 'ID da prefeitura' })
  @ApiQuery({
    name: 'startDate',
    required: false,
    description: 'Data inicial (ISO 8601) para filtrar por startedAt',
    example: '2026-05-01T00:00:00.000Z',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    description: 'Data final (ISO 8601) para filtrar por startedAt',
    example: '2026-05-31T23:59:59.999Z',
  })
  @ApiQuery({
    name: 'chassis',
    required: false,
    description: 'Filtro por chassi do equipamento',
    example: 'CAT-001',
  })
  @ApiQuery({
    name: 'operadorNome',
    required: false,
    description: 'Filtro por nome do operador',
    example: 'Jefferson',
  })
  async listRunsByPrefeitura(
    @Param('prefeituraId') prefeituraId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('chassis') chassis?: string,
    @Query('operadorNome') operadorNome?: string,
  ) {
    return this.service.listRunsByPrefeitura({
      prefeituraId,
      startDate,
      endDate,
      chassis,
      operadorNome,
    });
  }
}
