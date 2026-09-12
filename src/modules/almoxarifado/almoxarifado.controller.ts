import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PainelGuard, type RequestComPainel } from '../../common/painel.guard';
import { ModuloComercial } from '../../common/modulo-comercial.decorator';
import { AlmoxarifadoService } from './almoxarifado.service';

@ApiTags('almoxarifado')
@Controller('almoxarifado')
@UseGuards(PainelGuard)
// A feature é `suprimentos` e o grupo é `almoxarifado`: as duas chaves
// divergem, e o decorator não tem default justamente para isso.
@ModuloComercial('suprimentos', 'almoxarifado')
export class AlmoxarifadoController {
  constructor(private readonly servico: AlmoxarifadoService) {}

  @Get('pecas/por-codigo')
  @ApiOperation({ summary: 'Acha a peça pelo código interno ou do fabricante' })
  @ApiQuery({ name: 'codigo', required: true })
  async porCodigo(@Req() req: RequestComPainel, @Query('codigo') codigo = '') {
    return this.servico.buscarPorCodigo(req.painel.companyId, codigo);
  }
}
