import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SalvarPlanoPreventivoDto } from './dto/salvar-plano-preventivo.dto';
import { PlanosPreventivosService } from './planos-preventivos.service';

@ApiTags('planos-preventivos')
@Controller('planos-preventivos')
export class PlanosPreventivosController {
  constructor(private readonly service: PlanosPreventivosService) {}

  @Get(':prefeituraId')
  @ApiOperation({
    summary: 'Obter plano de manutenção preventiva do município',
    description:
      'Retorna { categorias: [{ id, nome, ciclos, linhas }] }. 404 quando ainda não foi salvo — front usa seed padrão.',
  })
  @ApiParam({ name: 'prefeituraId' })
  @ApiResponse({ status: 200, description: 'Plano carregado.' })
  @ApiResponse({ status: 404, description: 'Plano não encontrado.' })
  obter(@Param('prefeituraId') prefeituraId: string) {
    return this.service.obter(prefeituraId);
  }

  @Put(':prefeituraId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Salvar / substituir plano preventivo',
    description: 'Replace completo de { categorias } — cada categoria com a própria matriz.',
  })
  @ApiParam({ name: 'prefeituraId' })
  salvar(
    @Param('prefeituraId') prefeituraId: string,
    @Body() dto: SalvarPlanoPreventivoDto,
  ) {
    return this.service.salvar(prefeituraId, dto);
  }

  @Post(':prefeituraId/restaurar-padrao')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Restaurar plano padrão',
    description: 'Grava seed com 4 categorias (Fluidos, Filtros, Consumo, Serviço), cada uma com matriz própria.',
  })
  @ApiParam({ name: 'prefeituraId' })
  restaurarPadrao(@Param('prefeituraId') prefeituraId: string) {
    return this.service.restaurarPadrao(prefeituraId);
  }
}
