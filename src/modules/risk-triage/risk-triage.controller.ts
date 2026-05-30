import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { RiskTriageService } from './risk-triage.service';

@ApiTags('risk-triage')
@Controller('risk-triage')
export class RiskTriageController {
  constructor(private readonly service: RiskTriageService) {}

  @Get('prefeitura/:prefeituraId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar triagem de risco por prefeitura' })
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
  @ApiQuery({
    name: 'riskLevel',
    required: false,
    description: 'Nivel de risco (alto, medio, baixo)',
    example: 'alto',
  })
  async listByPrefeitura(
    @Param('prefeituraId') prefeituraId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('chassis') chassis?: string,
    @Query('operadorNome') operadorNome?: string,
    @Query('riskLevel') riskLevel?: 'alto' | 'medio' | 'baixo',
  ) {
    return this.service.listByPrefeitura({
      prefeituraId,
      startDate,
      endDate,
      chassis,
      operadorNome,
      riskLevel,
    });
  }
}
