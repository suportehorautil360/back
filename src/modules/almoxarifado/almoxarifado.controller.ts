import { Body, Controller, Get, Param, Post, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PainelGuard, type RequestComPainel } from '../../common/painel.guard';
import { ModuloComercial } from '../../common/modulo-comercial.decorator';
import { IdempotencyInterceptor } from '../../common/idempotency.interceptor';
import { AlmoxarifadoService } from './almoxarifado.service';
import { ReservarDto } from './dto/reserva.dto';
import { EntradaDto } from './dto/entrada.dto';
import { SepararDto } from './dto/separacao.dto';
import { EntregarDto } from './dto/entrega.dto';
import { CancelarRequisicaoDto } from './dto/cancelamento.dto';

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

  @Get('requisicoes')
  @ApiOperation({ summary: 'A fila do almoxarife' })
  @ApiQuery({ name: 'status', required: false })
  async requisicoes(@Req() req: RequestComPainel, @Query('status') status?: string) {
    return this.servico.listarRequisicoes(req.painel.companyId, status);
  }

  @Get('requisicoes/:id')
  @ApiOperation({ summary: 'Uma requisição com itens e depósito' })
  async requisicao(@Req() req: RequestComPainel, @Param('id') id: string) {
    return this.servico.detalharRequisicao(req.painel.companyId, id);
  }

  @Get('movimentos')
  @ApiOperation({ summary: 'O razão do estoque — histórico append-only, somente leitura' })
  @ApiQuery({ name: 'pecaId', required: false })
  @ApiQuery({ name: 'depositoId', required: false })
  @ApiQuery({ name: 'tipo', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'pageSize', required: false })
  async movimentos(
    @Req() req: RequestComPainel,
    @Query('pecaId') pecaId?: string,
    @Query('depositoId') depositoId?: string,
    @Query('tipo') tipo?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.servico.listarMovimentos(req.painel.companyId, {
      pecaId,
      depositoId,
      tipo,
      page: page !== undefined ? Number(page) : undefined,
      pageSize: pageSize !== undefined ? Number(pageSize) : undefined,
    });
  }

  @Post('requisicoes/:id/separar')
  // Mesma razão das outras duas rotas de escrita: reenvio de rede (ou duplo
  // clique) repetindo a MESMA conferência não pode mexer no saldo separado
  // duas vezes.
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Confere o kit item a item' })
  async separar(
    @Req() req: RequestComPainel,
    @Param('id') id: string,
    @Body() dto: SepararDto,
  ) {
    return this.servico.separarItens({
      companyId: req.painel.companyId,
      requisicaoId: id,
      autorCompanyUserId: req.painel.companyUserId,
      itens: dto.itens,
    });
  }

  @Post('requisicoes/:id/liberar')
  // Sem lock de saldo nenhum aqui (ver comentário do serviço), mas o
  // duplo clique ainda vale a mesma cautela das outras rotas de escrita —
  // não há razão para tratar esta diferente.
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Libera a OS para execução' })
  async liberar(@Req() req: RequestComPainel, @Param('id') id: string) {
    return this.servico.liberarRequisicao({
      companyId: req.painel.companyId,
      requisicaoId: id,
      autorCompanyUserId: req.painel.companyUserId,
    });
  }

  @Post('requisicoes/:id/entregar')
  // Entregar duas vezes tiraria a peça do estoque duas vezes — mesma razão
  // das rotas de reservar/entrada/separar, só que aqui o preço do reenvio
  // duplicado é decrementar `saldo_reservado` sem ter saído peça nenhuma a
  // mais do depósito.
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Entrega o kit ao mecânico' })
  async entregar(
    @Req() req: RequestComPainel,
    @Param('id') id: string,
    @Body() dto: EntregarDto,
  ) {
    return this.servico.entregarRequisicao({
      companyId: req.painel.companyId,
      requisicaoId: id,
      autorCompanyUserId: req.painel.companyUserId,
      recebedorOperatorId: dto.recebedorOperatorId,
      confirmacaoTipo: dto.confirmacaoTipo,
      assinatura: dto.assinatura ?? null,
    });
  }

  @Post('requisicoes/:id/cancelar')
  // Mesma cautela das outras rotas de escrita: reenvio de rede repetindo o
  // MESMO cancelamento não pode devolver o saldo reservado duas vezes.
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Cancela a requisição e devolve o saldo reservado' })
  async cancelar(
    @Req() req: RequestComPainel,
    @Param('id') id: string,
    @Body() dto: CancelarRequisicaoDto,
  ) {
    return this.servico.cancelarRequisicao({
      companyId: req.painel.companyId,
      requisicaoId: id,
      autorCompanyUserId: req.painel.companyUserId,
      motivo: dto.motivo,
    });
  }
}
