import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ConsumoCustoService } from './consumo-custo.service';

@ApiTags('movimentacoes')
@Controller('movimentacoes/consumo-custo')
export class ConsumoCustoController {
  constructor(private readonly service: ConsumoCustoService) {}

  @Get(':prefeituraId')
  @ApiOperation({
    summary: 'Consumo e custo por veículo (payload pronto para a tela)',
  })
  @ApiParam({ name: 'prefeituraId' })
  @ApiQuery({
    name: 'startDate',
    required: false,
    description: 'Início do período (YYYY-MM-DD)',
    example: '2026-05-27',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    description: 'Fim do período (YYYY-MM-DD)',
    example: '2026-06-03',
  })
  @ApiOkResponse({
    description: 'Payload da tela Consumo & Custo por Veículo',
  })
  listarPorPrefeitura(
    @Param('prefeituraId') prefeituraId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.service.listarPorPrefeitura(prefeituraId, startDate, endDate);
  }
}
