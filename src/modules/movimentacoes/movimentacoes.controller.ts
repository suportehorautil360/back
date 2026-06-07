import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { MovimentacoesService } from './movimentacoes.service';

@ApiTags('movimentacoes')
@Controller('movimentacoes')
export class MovimentacoesController {
  constructor(private readonly movimentacoesService: MovimentacoesService) {}

  @Get(':prefeituraId')
  @ApiOperation({ summary: 'Listar movimentações da prefeitura' })
  @ApiParam({ name: 'prefeituraId' })
  @ApiQuery({
    name: 'startDate',
    required: false,
    description: 'Início do período (ISO 8601 ou YYYY-MM-DD)',
    example: '2026-06-01',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    description: 'Fim do período (ISO 8601 ou YYYY-MM-DD)',
    example: '2026-06-30',
  })
  async listar(
    @Param('prefeituraId') prefeituraId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.movimentacoesService.listarHistorico(
      prefeituraId,
      startDate,
      endDate,
    );
  }
}
