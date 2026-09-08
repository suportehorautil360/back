import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PainelGuard, type RequestComPainel } from '../../common/painel.guard';
import { MecanicaService } from './mecanica.service';

@ApiTags('mecanica')
@Controller('mecanica')
@UseGuards(PainelGuard)
export class MecanicaController {
  constructor(private readonly service: MecanicaService) {}

  @Get('os')
  @ApiOperation({ summary: 'Bancada: OS internas da empresa do token' })
  async bancada(
    @Req() req: RequestComPainel,
    @Query('minhas') minhas?: string,
  ) {
    return this.service.listarBancada(req.painel, minhas === 'true');
  }

  @Get('os/:id')
  @ApiOperation({ summary: 'Detalhe de uma OS interna' })
  async detalhe(@Req() req: RequestComPainel, @Param('id') id: string) {
    return this.service.detalhe(req.painel, id);
  }
}
