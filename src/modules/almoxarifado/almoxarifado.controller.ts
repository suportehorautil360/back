import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PainelGuard, type RequestComPainel } from '../../common/painel.guard';
import { ModuloComercial } from '../../common/modulo-comercial.decorator';
import { AlmoxarifadoService } from './almoxarifado.service';
import { ReservarDto } from './dto/reserva.dto';
import { EntradaDto } from './dto/entrada.dto';

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

  @Post('os/:osId/reservar')
  @ApiOperation({ summary: 'Consulta o estoque e reserva o que existe para a OS' })
  async reservar(
    @Req() req: RequestComPainel,
    @Param('osId') osId: string,
    @Body() dto: ReservarDto,
  ) {
    return this.servico.reservarParaOs({
      companyId: req.painel.companyId,
      serviceOrderId: osId,
      depositoId: dto.depositoId,
      autorCompanyUserId: req.painel.companyUserId,
      categoriaPlanoId: dto.categoriaPlanoId,
      cicloId: dto.cicloId,
    });
  }

  @Post('entradas')
  @ApiOperation({ summary: 'Dá entrada de peça no depósito' })
  async entrada(@Req() req: RequestComPainel, @Body() dto: EntradaDto) {
    return this.servico.darEntrada({
      companyId: req.painel.companyId,
      autorCompanyUserId: req.painel.companyUserId,
      pecaId: dto.pecaId,
      depositoId: dto.depositoId,
      quantidade: dto.quantidade,
      custoUnit: dto.custoUnit ?? null,
      observacao: dto.observacao ?? null,
    });
  }
}
