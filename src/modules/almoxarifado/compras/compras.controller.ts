import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { IdempotencyInterceptor } from '../../../common/idempotency.interceptor';
import { ModuloComercial } from '../../../common/modulo-comercial.decorator';
import { PainelGuard, type RequestComPainel } from '../../../common/painel.guard';
import { ComprasService } from './compras.service';
import { MotivoDto } from './dto/motivo.dto';
import { CriarOrdemDto, EditarOrdemDto, SubstituirItensDto } from './dto/ordem-compra.dto';
import { CriarSolicitacaoDto } from './dto/solicitacao-compra.dto';

/**
 * Compras (F4.1): solicitação manual e ordem de compra.
 *
 * `companyId` e autor vêm SEMPRE de `req.painel` (resolvido do token pelo
 * `PainelGuard`), nunca do corpo. Toda rota de escrita leva o
 * `IdempotencyInterceptor`: duplo clique ou reenvio de rede repetindo a MESMA
 * emissão somaria o `saldo_em_compra` duas vezes — o teste de metadata deste
 * controller recusa rota de escrita sem ele.
 *
 * `:id` passa por `ParseUUIDPipe`: um id malformado viraria erro de sintaxe de
 * UUID no `::uuid` da trava, um 500 cru.
 */
@ApiTags('compras')
@Controller('compras')
@UseGuards(PainelGuard)
@ModuloComercial('suprimentos', 'compras')
export class ComprasController {
  constructor(private readonly servico: ComprasService) {}

  // --- Solicitações ----------------------------------------------------------

  @Get('solicitacoes')
  @ApiOperation({ summary: 'A fila de solicitações de compra (pendentes e em cotação, por padrão)' })
  @ApiQuery({ name: 'status', required: false })
  async listarSolicitacoes(@Req() req: RequestComPainel, @Query('status') status?: string) {
    return this.servico.listarSolicitacoes(req.painel.companyId, status);
  }

  @Get('solicitacoes/:id')
  @ApiOperation({ summary: 'Uma solicitação de compra com a situação de cada item' })
  async detalharSolicitacao(@Req() req: RequestComPainel, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.servico.detalharSolicitacao(req.painel.companyId, id);
  }

  @Post('solicitacoes')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Abre uma solicitação de compra manual' })
  async criarSolicitacao(@Req() req: RequestComPainel, @Body() dto: CriarSolicitacaoDto) {
    return this.servico.criarSolicitacao({
      companyId: req.painel.companyId,
      autorCompanyUserId: req.painel.companyUserId,
      depositoId: dto.depositoId,
      prioridade: dto.prioridade,
      justificativa: dto.justificativa,
      itens: dto.itens.map((i) => ({ pecaId: i.pecaId, quantidade: i.quantidade })),
    });
  }

  @Post('solicitacoes/:id/rejeitar')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Rejeita uma solicitação manual ou de estoque mínimo, com motivo' })
  async rejeitarSolicitacao(
    @Req() req: RequestComPainel,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: MotivoDto,
  ) {
    return this.servico.rejeitarSolicitacao({
      companyId: req.painel.companyId,
      solicitacaoId: id,
      autorCompanyUserId: req.painel.companyUserId,
      motivo: dto.motivo,
    });
  }

  @Post('solicitacoes/:id/cancelar')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Cancela uma solicitação manual ou de estoque mínimo, com motivo' })
  async cancelarSolicitacao(
    @Req() req: RequestComPainel,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: MotivoDto,
  ) {
    return this.servico.cancelarSolicitacao({
      companyId: req.painel.companyId,
      solicitacaoId: id,
      autorCompanyUserId: req.painel.companyUserId,
      motivo: dto.motivo,
    });
  }

  // --- Ordens de compra ------------------------------------------------------

  @Get('ordens')
  @ApiOperation({ summary: 'Ordens de compra em andamento (ou de um status)' })
  @ApiQuery({ name: 'status', required: false })
  async listarOrdens(@Req() req: RequestComPainel, @Query('status') status?: string) {
    return this.servico.listarOrdens(req.painel.companyId, req.painel.companyUserId, status);
  }

  @Get('ordens/:id')
  @ApiOperation({ summary: 'Uma ordem de compra com itens e origens' })
  async detalharOrdem(@Req() req: RequestComPainel, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.servico.detalharOrdem(req.painel.companyId, req.painel.companyUserId, id);
  }

  @Post('ordens')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Abre uma ordem de compra em rascunho (a cotação)' })
  async criarOrdem(@Req() req: RequestComPainel, @Body() dto: CriarOrdemDto) {
    return this.servico.criarOrdem({
      companyId: req.painel.companyId,
      autorCompanyUserId: req.painel.companyUserId,
      partnerId: dto.partnerId,
      depositoId: dto.depositoId,
      condicaoPagamento: dto.condicaoPagamento,
      previsaoEntrega: dto.previsaoEntrega,
      observacao: dto.observacao,
    });
  }

  @Patch('ordens/:id')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Edita o cabeçalho de um rascunho' })
  async editarOrdem(
    @Req() req: RequestComPainel,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: EditarOrdemDto,
  ) {
    return this.servico.editarOrdem({
      companyId: req.painel.companyId,
      ordemCompraId: id,
      autorCompanyUserId: req.painel.companyUserId,
      partnerId: dto.partnerId,
      condicaoPagamento: dto.condicaoPagamento,
      previsaoEntrega: dto.previsaoEntrega,
      observacao: dto.observacao,
    });
  }

  @Put('ordens/:id/itens')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Substitui todos os itens do rascunho (lista vazia limpa)' })
  async substituirItens(
    @Req() req: RequestComPainel,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SubstituirItensDto,
  ) {
    return this.servico.substituirItens({
      companyId: req.painel.companyId,
      ordemCompraId: id,
      autorCompanyUserId: req.painel.companyUserId,
      itens: dto.itens.map((i) => ({
        pecaId: i.pecaId,
        valorUnit: i.valorUnit,
        origens: i.origens.map((o) => ({ solicitacaoCompraItemId: o.solicitacaoCompraItemId, quantidade: o.quantidade })),
      })),
    });
  }

  @Post('ordens/:id/confirmar')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Fecha a cotação: emite dentro do limite, senão espera aprovação' })
  async confirmarOrdem(@Req() req: RequestComPainel, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.servico.confirmarOrdem({
      companyId: req.painel.companyId,
      ordemCompraId: id,
      autorCompanyUserId: req.painel.companyUserId,
    });
  }

  @Post('ordens/:id/aprovar')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Aprova e emite uma ordem acima do limite' })
  async aprovarOrdem(@Req() req: RequestComPainel, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.servico.aprovarOrdem({
      companyId: req.painel.companyId,
      ordemCompraId: id,
      autorCompanyUserId: req.painel.companyUserId,
    });
  }

  @Post('ordens/:id/devolver')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Devolve a ordem em aprovação para rascunho, com motivo' })
  async devolverOrdem(
    @Req() req: RequestComPainel,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: MotivoDto,
  ) {
    return this.servico.devolverOrdem({
      companyId: req.painel.companyId,
      ordemCompraId: id,
      autorCompanyUserId: req.painel.companyUserId,
      motivo: dto.motivo,
    });
  }

  @Post('ordens/:id/enviar')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Marca a ordem emitida como enviada ao fornecedor' })
  async enviarOrdem(@Req() req: RequestComPainel, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.servico.enviarOrdem({
      companyId: req.painel.companyId,
      ordemCompraId: id,
      autorCompanyUserId: req.painel.companyUserId,
    });
  }

  @Post('ordens/:id/cancelar')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Cancela a ordem que ainda não recebeu nada, com motivo' })
  async cancelarOrdem(
    @Req() req: RequestComPainel,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: MotivoDto,
  ) {
    return this.servico.cancelarOrdem({
      companyId: req.painel.companyId,
      ordemCompraId: id,
      autorCompanyUserId: req.painel.companyUserId,
      motivo: dto.motivo,
    });
  }

  @Post('ordens/:id/encerrar')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Encerra a ordem que recebeu parte e não vai receber o resto, com motivo' })
  async encerrarOrdem(
    @Req() req: RequestComPainel,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: MotivoDto,
  ) {
    return this.servico.encerrarOrdem({
      companyId: req.painel.companyId,
      ordemCompraId: id,
      autorCompanyUserId: req.painel.companyUserId,
      motivo: dto.motivo,
    });
  }
}
