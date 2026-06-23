import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ListGarantiasEquipamentoQueryDto } from './dto/list-garantias-equipamento-query.dto';
import { GarantiasService } from './garantias.service';

@ApiTags('garantias')
@Controller('garantias')
export class GarantiasController {
  constructor(private readonly service: GarantiasService) {}

  @Get('equipamento/:equipamentoId')
  @ApiOperation({
    summary: 'Histórico de garantia por equipamento',
    description:
      'Alimenta a aba Garantia ao abrir O.S. Cruza prazo em meses e limite de horímetro ' +
      'com horimetroAtual (query) para status vigente / vencendo / vencido.',
  })
  @ApiParam({ name: 'equipamentoId' })
  @ApiQuery({ name: 'horimetroAtual', required: false })
  @ApiQuery({ name: 'status', required: false, example: 'vigente' })
  @ApiQuery({ name: 'tipo', required: false, example: 'peca' })
  @ApiQuery({ name: 'busca', required: false })
  listarPorEquipamento(
    @Param('equipamentoId') equipamentoId: string,
    @Query() query: ListGarantiasEquipamentoQueryDto,
  ) {
    return this.service.listarPorEquipamento(equipamentoId, query);
  }
}
