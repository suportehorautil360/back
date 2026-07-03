import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ChecklistsRegistrosService } from './checklists-registros.service';

@ApiTags('checklists-registros')
@Controller('checklists-registros')
export class ChecklistsRegistrosController {
  constructor(private readonly service: ChecklistsRegistrosService) {}

  @Get('prefeitura/:prefeituraId')
  @ApiOperation({
    summary: 'Listar checklists de operador da prefeitura',
    description:
      'Lê a coleção checklistsRegistros (PWA do operador) filtrada por prefeituraId.',
  })
  @ApiParam({ name: 'prefeituraId' })
  listarPorPrefeitura(@Param('prefeituraId') prefeituraId: string) {
    return this.service.listarPorPrefeitura(prefeituraId);
  }

  @Get('prefeitura/:prefeituraId/top-operadores')
  @ApiOperation({
    summary: 'Top operadores por quantidade de checklists no mês',
  })
  @ApiParam({ name: 'prefeituraId' })
  @ApiQuery({
    name: 'mes',
    required: false,
    description: 'Mês no formato YYYY-MM (padrão: mês atual)',
    example: '2026-07',
  })
  @ApiQuery({
    name: 'limite',
    required: false,
    description: 'Quantidade máxima de operadores no ranking',
    example: 5,
  })
  topOperadores(
    @Param('prefeituraId') prefeituraId: string,
    @Query('mes') mes?: string,
    @Query('limite') limite?: string,
  ) {
    const limiteNum = limite ? Number.parseInt(limite, 10) : 5;
    return this.service.topOperadores(
      prefeituraId,
      mes,
      Number.isFinite(limiteNum) && limiteNum > 0 ? limiteNum : 5,
    );
  }

  @Get('prefeitura/:prefeituraId/resumo-painel')
  @ApiOperation({
    summary: 'Resumo do painel (semanas + top operadores no mês)',
  })
  @ApiParam({ name: 'prefeituraId' })
  @ApiQuery({
    name: 'mes',
    required: false,
    description: 'Mês no formato YYYY-MM (padrão: mês atual)',
    example: '2026-07',
  })
  resumoPainel(
    @Param('prefeituraId') prefeituraId: string,
    @Query('mes') mes?: string,
  ) {
    return this.service.resumoPainel(prefeituraId, mes);
  }
}
