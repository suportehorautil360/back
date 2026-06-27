import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ListGarantiasEquipamentoQueryDto } from './dto/list-garantias-equipamento-query.dto';
import { ListGarantiasSolicitacaoQueryDto } from './dto/list-garantias-solicitacao-query.dto';
import { GarantiasService } from './garantias.service';

@ApiTags('garantias')
@Controller('garantias')
export class GarantiasController {
  constructor(private readonly service: GarantiasService) {}

  @Get('solicitacao/:solicitacaoOsId')
  @ApiOperation({
    summary: 'Garantias da O.S. (derivadas do CHD)',
    description:
      'Calcula peças/serviços em garantia a partir do checklist de devolução (CHD) ' +
      'vinculado à solicitação — sem exigir conferência/aceite. Complementa registros ' +
      'persistidos em garantias quando existirem.',
  })
  @ApiParam({ name: 'solicitacaoOsId' })
  @ApiQuery({ name: 'horimetroAtual', required: false })
  @ApiQuery({ name: 'status', required: false, example: 'vigente' })
  @ApiQuery({ name: 'tipo', required: false, example: 'peca' })
  @ApiQuery({ name: 'busca', required: false })
  listarPorSolicitacao(
    @Param('solicitacaoOsId') solicitacaoOsId: string,
    @Query() query: ListGarantiasSolicitacaoQueryDto,
  ) {
    return this.service.listarPorSolicitacao(solicitacaoOsId, query);
  }

  @Get('equipamento/:equipamentoId')
  @ApiOperation({
    summary: 'Histórico de garantia por equipamento',
    description:
      'Alimenta a aba Garantia ao abrir O.S. Cruza prazo em meses e limite de horímetro ' +
      'com horimetroAtual (query) para status vigente / vencendo / vencido. ' +
      'Inclui CHDs vinculados às O.S. do equipamento, sem exigir aceite.',
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
