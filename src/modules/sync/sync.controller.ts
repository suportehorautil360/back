import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';

import { SyncService } from './sync.service';

@ApiTags('sync')
@Controller('sync')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class SyncController {
  constructor(private readonly service: SyncService) {}

  @Get('pull/:prefeituraId/:colecao')
  @ApiOperation({
    summary: 'Página incremental de uma coleção espelhada no app do operador.',
    description:
      'Paginação keyset por (updated_at, id). O `cursor` é OPACO: devolva-o ' +
      'como veio. `remocoes` traz o que foi apagado desde o cursor — sem isso ' +
      'equipamento removido no painel ficaria para sempre no tablet.',
  })
  async pull(
    @Param('prefeituraId') prefeituraId: string,
    @Param('colecao') colecao: string,
    @Query('cursor') cursor?: string,
    @Query('limite') limite?: string,
  ) {
    const data = await this.service.puxar(
      prefeituraId,
      colecao,
      cursor,
      limite ? Number(limite) : undefined,
    );
    return { data, message: 'ok' };
  }
}
