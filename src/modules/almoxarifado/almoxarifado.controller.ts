import { Body, Controller, Get, Param, Post, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PainelGuard, type RequestComPainel } from '../../common/painel.guard';
import { ModuloComercial } from '../../common/modulo-comercial.decorator';
import { IdempotencyInterceptor } from '../../common/idempotency.interceptor';
import { AlmoxarifadoService } from './almoxarifado.service';
import { ReservarDto } from './dto/reserva.dto';
import { EntradaDto } from './dto/entrada.dto';
import { SepararDto } from './dto/separacao.dto';
import { DecidirEquivalenteDto, ProporEquivalenteDto } from './dto/equivalente.dto';
import { AlterarPrioridadeDto } from './dto/prioridade.dto';
import { EntregarDto } from './dto/entrega.dto';
import { CancelarRequisicaoDto } from './dto/cancelamento.dto';
import { ReceberDto } from './dto/recebimento.dto';
import { PedirPecaAdicionalDto } from './dto/peca-adicional.dto';
import { VerificarEstoqueMinimoDto } from './dto/estoque-minimo.dto';
import { DevolverSobraDto } from './dto/devolucao.dto';
import { AbrirInventarioDto, ApurarInventarioDto, CancelarInventarioDto, RegistrarContagemDto } from './dto/inventario.dto';

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
  // Fundação da F4: quem reserva é quem ABRE a OS preventiva — a Manutenção.
  // Com o gate da classe (`almoxarifado`), todo programador cujo cargo não
  // tem o grupo do almoxarife levava 403, e a OS nascia em análise sem falta
  // detectada — portanto sem solicitação de compra. O `PainelGuard` lê a
  // metadata da ROTA antes da da classe, então esta sobrescreve só aqui.
  @ModuloComercial('suprimentos', 'manutencao')
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

  @Post('requisicoes/:id/equivalentes')
  // Quem PROPÕE é o almoxarife: é ele que está com a prateleira na frente e
  // vê que a equivalente existe. O gate da classe (`almoxarifado`) já serve.
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Propõe trocar a peça que falta por uma equivalente' })
  async proporEquivalente(
    @Req() req: RequestComPainel,
    @Param('id') id: string,
    @Body() dto: ProporEquivalenteDto,
  ) {
    return this.servico.proporTroca({
      companyId: req.painel.companyId,
      requisicaoId: id,
      itemId: dto.itemId,
      pecaEquivalenteId: dto.pecaEquivalenteId,
      autorCompanyUserId: req.painel.companyUserId,
      motivo: dto.motivo,
    });
  }

  @Post('requisicoes/:id/equivalentes/decidir')
  // Quem DECIDE é a mecânica — só ela sabe se a peça de outra marca serve
  // naquela máquina (critério 11). Mesmo gate do pedido de peça adicional,
  // que é o outro ato do mecânico neste módulo; a rota sobrescreve o da
  // classe. Por que não o responsável da OS: `responsavelOperatorId` é nulo
  // em OS parceira por definição e opcional na interna — gatear por ele
  // travaria a troca em toda OS sem mecânico designado, que hoje são todas.
  @ModuloComercial('suprimentos', 'mecanica')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Aprova ou recusa tecnicamente a peça equivalente proposta' })
  async decidirEquivalente(
    @Req() req: RequestComPainel,
    @Param('id') id: string,
    @Body() dto: DecidirEquivalenteDto,
  ) {
    return this.servico.decidirTroca({
      companyId: req.painel.companyId,
      requisicaoId: id,
      itemId: dto.itemId,
      aprovar: dto.aprovar,
      autorCompanyUserId: req.painel.companyUserId,
      motivo: dto.motivo,
    });
  }

  @Post('compras/prioridade')
  // Quem muda a ordem da fila é quem COMPRA — o gate da classe é
  // `almoxarifado`, e esta rota o sobrescreve. Prioridade decide quem recebe
  // a peça que chega (§8), então é decisão de quem responde pela compra.
  @ModuloComercial('suprimentos', 'compras')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Muda a prioridade de um item da fila de compra' })
  async alterarPrioridade(@Req() req: RequestComPainel, @Body() dto: AlterarPrioridadeDto) {
    return this.servico.alterarPrioridade({
      companyId: req.painel.companyId,
      solicitacaoItemId: dto.solicitacaoItemId,
      prioridade: dto.prioridade,
      autorCompanyUserId: req.painel.companyUserId,
      motivo: dto.motivo,
    });
  }

  @Post('inventarios')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Abre a contagem cíclica de um depósito' })
  async abrirInventario(@Req() req: RequestComPainel, @Body() dto: AbrirInventarioDto) {
    return this.servico.abrirContagem({
      companyId: req.painel.companyId,
      depositoId: dto.depositoId,
      pecaIds: dto.pecaIds,
      autorCompanyUserId: req.painel.companyUserId,
      observacao: dto.observacao ?? null,
    });
  }

  @Post('inventarios/itens/:id/contagem')
  // Sem idempotência: recontar é o fluxo LEGÍTIMO, e a rota grava valor
  // absoluto (não incrementa). Reenvio grava o mesmo número de novo.
  @ApiOperation({ summary: 'Registra o que foi achado na prateleira' })
  async registrarContagem(
    @Req() req: RequestComPainel,
    @Param('id') id: string,
    @Body() dto: RegistrarContagemDto,
  ) {
    return this.servico.registrarContagemDeItem({
      companyId: req.painel.companyId,
      inventarioItemId: id,
      quantidadeContada: dto.quantidadeContada,
      autorCompanyUserId: req.painel.companyUserId,
    });
  }

  @Post('inventarios/:id/cancelar')
  // Idempotência como nos outros atos que mudam o estado do documento: o
  // reenvio bate na recusa de "não está aberta", mas a chave fecha a corrida.
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Desiste da contagem sem apurar, liberando o depósito' })
  async cancelarInventario(
    @Req() req: RequestComPainel,
    @Param('id') id: string,
    @Body() dto: CancelarInventarioDto,
  ) {
    return this.servico.cancelarContagem({
      companyId: req.painel.companyId,
      inventarioId: id,
      autorCompanyUserId: req.painel.companyUserId,
      motivo: dto.motivo,
    });
  }

  @Post('inventarios/:id/apurar')
  // Idempotência aqui SIM: apurar mexe em saldo, e um reenvio aplicaria os
  // ajustes duas vezes se o status ainda não tivesse virado.
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Fecha a contagem: as diferenças viram ajuste' })
  async apurarInventario(
    @Req() req: RequestComPainel,
    @Param('id') id: string,
    @Body() dto: ApurarInventarioDto,
  ) {
    return this.servico.apurarContagem({
      companyId: req.painel.companyId,
      inventarioId: id,
      autorCompanyUserId: req.painel.companyUserId,
      motivo: dto.motivo,
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

  @Get('recebimentos/pendentes')
  @ApiOperation({ summary: 'Ordens de compra emitidas com peça por chegar' })
  async recebimentosPendentes(@Req() req: RequestComPainel) {
    return this.servico.listarRecebimentosPendentes(req.painel.companyId);
  }

  @Post('recebimentos')
  // Quem recebe é o almoxarife (gate da classe). Receber duas vezes a MESMA
  // nota somaria o físico duas vezes e baixaria o `saldo_em_compra` de um
  // pedido que não chegou em dobro — a chave de idempotência faz o reenvio
  // devolver a resposta gravada.
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Registra o recebimento de uma ordem de compra' })
  async receber(@Req() req: RequestComPainel, @Body() dto: ReceberDto) {
    return this.servico.receberOrdemDeCompra({
      companyId: req.painel.companyId,
      autorCompanyUserId: req.painel.companyUserId,
      ordemCompraId: dto.ordemCompraId,
      notaFiscalNumero: dto.notaFiscalNumero?.trim() || null,
      notaFiscalChave: dto.notaFiscalChave?.trim() || null,
      observacao: dto.observacao?.trim() || null,
      itens: dto.itens.map((i) => ({
        ordemCompraItemId: i.ordemCompraItemId,
        quantidadeRecebida: i.quantidadeRecebida,
        quantidadeRecusada: i.quantidadeRecusada ?? 0,
        valorUnit: i.valorUnit ?? null,
        lote: i.lote?.trim() || null,
        validade: i.validade ? new Date(i.validade) : null,
        divergencia: i.divergencia ?? null,
      })),
    });
  }

  @Post('os/:osId/pecas-adicionais')
  // Quem pede é o mecânico, pela bancada — o grupo `mecanica`, não o do
  // almoxarife. A rota sobrescreve o gate da classe, como a de reservar.
  @ModuloComercial('suprimentos', 'mecanica')
  // Duplo clique pedindo a mesma peça reservaria o saldo duas vezes e
  // abriria duas solicitações de compra.
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Pede ao almoxarifado uma peça fora do kit, com a OS em andamento' })
  async pedirPecaAdicional(
    @Req() req: RequestComPainel,
    @Param('osId') osId: string,
    @Body() dto: PedirPecaAdicionalDto,
  ) {
    return this.servico.pedirPecaAdicional({
      companyId: req.painel.companyId,
      serviceOrderId: osId,
      autorCompanyUserId: req.painel.companyUserId,
      pecaId: dto.pecaId,
      quantidade: dto.quantidade,
      impeditivo: dto.impeditivo,
      motivo: dto.motivo,
    });
  }

  @Get('os/:osId/pecas-adicionais')
  @ModuloComercial('suprimentos', 'mecanica')
  @ApiOperation({ summary: 'As peças adicionais pedidas para a OS, com o estado de cada uma' })
  async pecasAdicionais(@Req() req: RequestComPainel, @Param('osId') osId: string) {
    return this.servico.listarPecasAdicionais(req.painel.companyId, osId);
  }

  @Post('estoque-minimo/verificar')
  // Sem `IdempotencyInterceptor` de propósito: a verificação é idempotente
  // por construção — o índice único parcial deixa existir no máximo uma
  // reposição automática aberta por peça e depósito, e a segunda chamada não
  // cria nada.
  @ApiOperation({ summary: 'Confere a reposição automática da peça nos depósitos em que ela tem saldo' })
  async verificarEstoqueMinimo(@Req() req: RequestComPainel, @Body() dto: VerificarEstoqueMinimoDto) {
    return this.servico.verificarEstoqueMinimoDaPeca(req.painel.companyId, dto.pecaId);
  }

  @Post('requisicoes/:id/devolucoes')
  // Quem recebe a sobra no balcão é o almoxarife (gate da classe). Sem a
  // chave, um reenvio de rede devolveria a mesma peça duas vezes — subindo o
  // físico por peça que voltou uma vez só.
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Devolve ao estoque a sobra de um kit já entregue' })
  async devolver(
    @Req() req: RequestComPainel,
    @Param('id') id: string,
    @Body() dto: DevolverSobraDto,
  ) {
    return this.servico.devolverSobra({
      companyId: req.painel.companyId,
      requisicaoId: id,
      autorCompanyUserId: req.painel.companyUserId,
      motivo: dto.motivo,
      recebidoDe: dto.recebidoDe?.trim() || null,
      itens: dto.itens.map((i) => ({ itemId: i.itemId, quantidade: i.quantidade })),
    });
  }
}
