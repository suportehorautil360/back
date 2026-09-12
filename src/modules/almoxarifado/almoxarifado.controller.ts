import { Body, Controller, Get, Param, Post, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PainelGuard, type RequestComPainel } from '../../common/painel.guard';
import { ModuloComercial } from '../../common/modulo-comercial.decorator';
import { IdempotencyInterceptor } from '../../common/idempotency.interceptor';
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
  // Achado Important I3: duplo clique (ou reenvio automático do outbox
  // offline) chamando esta rota duas vezes reservava o saldo duas vezes
  // para a mesma OS. `Idempotency-Key` faz o segundo envio da MESMA
  // requisição devolver a resposta gravada em vez de rodar de novo — mesmo
  // molde de `solicitacoes-ponto`. A checagem de requisição já aberta para
  // a OS (dentro da transação, em `executarReserva`) cobre o clique
  // repetido depois que a primeira resposta já chegou.
  @UseInterceptors(IdempotencyInterceptor)
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
  // Mesma razão da rota de reservar: sem chave de idempotência, reenvio de
  // rede duplicaria a entrada no razão (append-only — o movimento duplicado
  // não se apaga, só se compensa com outro lançamento).
  @UseInterceptors(IdempotencyInterceptor)
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
