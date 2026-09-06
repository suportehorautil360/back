import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import {
  OperadorGuard,
  type RequestComOperador,
} from '../../common/operador.guard';
import { PontoService } from './ponto.service';

@ApiTags('ponto')
@ApiBearerAuth()
@Controller('ponto')
@UseGuards(OperadorGuard)
export class PontoController {
  constructor(private readonly service: PontoService) {}

  @Get('registros')
  @ApiOperation({
    summary: 'Batidas efetivas da PRÓPRIA pessoa no período.',
    description:
      'A identidade vem do token, nunca da query — não existe parâmetro de CPF. ' +
      'O intervalo é de instantes ISO: o aparelho resolve a própria fronteira ' +
      'de dia local e o servidor só filtra.',
  })
  @ApiQuery({ name: 'de', example: '2026-09-06T03:00:00.000Z' })
  @ApiQuery({ name: 'ate', example: '2026-09-07T03:00:00.000Z' })
  async registros(
    @Req() req: RequestComOperador,
    @Query('de') de: string,
    @Query('ate') ate: string,
  ) {
    const data = await this.service.registrosDoPeriodo(
      req.operador.funcionarioId,
      req.operador.prefeituraId,
      new Date(de),
      new Date(ate),
    );
    return { data, message: 'ok' };
  }
}
