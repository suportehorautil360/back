import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PainelGuard, type RequestComPainel } from '../../common/painel.guard';
import { ModuloComercial } from '../../common/modulo-comercial.decorator';
import { MecanicaService } from './mecanica.service';
import type { SituacaoOs } from './mecanica.service';
import {
  EditarApontamentoDto,
  LancarApontamentoDto,
} from './dto/apontamento.dto';
import { FotoDto, OcorrenciaDto, PecaDto } from './dto/anexos.dto';
import { LaudoDto } from './dto/laudo.dto';

const SITUACOES_VALIDAS: readonly SituacaoOs[] = [
  'Aberta',
  'EmAndamento',
  'Concluida',
];

/**
 * `?situacao` é opcional — sem ela, a Bancada devolve tudo. Quando vem, só os
 * três valores da coluna são aceitos: nem vira filtro silencioso (que faria a
 * query devolver uma lista vazia sem avisar por quê) nem estoura 500.
 */
function validarSituacao(situacao?: string): SituacaoOs | undefined {
  if (situacao === undefined) return undefined;
  if (!SITUACOES_VALIDAS.includes(situacao as SituacaoOs)) {
    throw new BadRequestException(
      `situacao inválida: use ${SITUACOES_VALIDAS.join(', ')}.`,
    );
  }
  return situacao as SituacaoOs;
}

@ApiTags('mecanica')
@Controller('mecanica')
@UseGuards(PainelGuard)
@ModuloComercial('mecanica')
export class MecanicaController {
  constructor(private readonly service: MecanicaService) {}

  @Get('os')
  @ApiOperation({
    summary:
      'Bancada: OS internas da empresa do token. `situacao` filtra (ex.: Histórico usa Concluida).',
  })
  async bancada(
    @Req() req: RequestComPainel,
    @Query('minhas') minhas?: string,
    @Query('situacao') situacao?: string,
  ) {
    return this.service.listarBancada(
      req.painel,
      minhas === 'true',
      validarSituacao(situacao),
    );
  }

  @Get('os/:id')
  @ApiOperation({ summary: 'Detalhe de uma OS interna' })
  async detalhe(@Req() req: RequestComPainel, @Param('id') id: string) {
    return this.service.detalhe(req.painel, id);
  }

  @Post('os/:id/assumir')
  @ApiOperation({ summary: 'Assumir a OS — grava o responsável' })
  async assumir(@Req() req: RequestComPainel, @Param('id') id: string) {
    return this.service.assumir(req.painel, id);
  }

  @Post('os/:id/apontamentos/iniciar')
  @ApiOperation({ summary: 'Iniciar apontamento (fim em aberto)' })
  async iniciar(@Req() req: RequestComPainel, @Param('id') id: string) {
    return this.service.iniciarApontamento(req.painel, id);
  }

  @Post('apontamentos/:id/parar')
  @ApiOperation({ summary: 'Parar o apontamento aberto' })
  async parar(@Req() req: RequestComPainel, @Param('id') id: string) {
    return this.service.pararApontamento(req.painel, id);
  }

  @Post('os/:id/apontamentos')
  @ApiOperation({ summary: 'Lançar apontamento com início e fim' })
  async lancar(
    @Req() req: RequestComPainel,
    @Param('id') id: string,
    @Body() dto: LancarApontamentoDto,
  ) {
    return this.service.lancarApontamento(
      req.painel,
      id,
      new Date(dto.inicio),
      new Date(dto.fim),
      dto.observacao ?? null,
    );
  }

  @Patch('apontamentos/:id')
  @ApiOperation({ summary: 'Editar um apontamento do próprio mecânico' })
  async editar(
    @Req() req: RequestComPainel,
    @Param('id') id: string,
    @Body() dto: EditarApontamentoDto,
  ) {
    return this.service.editarApontamento(
      req.painel,
      id,
      new Date(dto.inicio),
      dto.fim ? new Date(dto.fim) : null,
      dto.observacao ?? null,
    );
  }

  @Delete('apontamentos/:id')
  @ApiOperation({ summary: 'Remover um apontamento do próprio mecânico' })
  async remover(@Req() req: RequestComPainel, @Param('id') id: string) {
    return this.service.removerApontamento(req.painel, id);
  }

  @Post('os/:id/pecas')
  @ApiOperation({ summary: 'Registrar peça consumida na OS' })
  async adicionarPeca(
    @Req() req: RequestComPainel,
    @Param('id') id: string,
    @Body() dto: PecaDto,
  ) {
    return this.service.adicionarPeca(req.painel, id, {
      descricao: dto.descricao,
      quantidade: dto.quantidade,
      valorUnit: dto.valorUnit,
      codigo: dto.codigo ?? null,
      marca: dto.marca ?? null,
      unidade: dto.unidade ?? null,
    });
  }

  @Post('os/:id/fotos')
  @ApiOperation({ summary: 'Anexar foto (URL do Storage) à OS' })
  async adicionarFoto(
    @Req() req: RequestComPainel,
    @Param('id') id: string,
    @Body() dto: FotoDto,
  ) {
    return this.service.adicionarFoto(
      req.painel,
      id,
      dto.url,
      dto.legenda ?? null,
    );
  }

  @Post('os/:id/ocorrencias')
  @ApiOperation({ summary: 'Registrar ocorrência na timeline da OS' })
  async adicionarOcorrencia(
    @Req() req: RequestComPainel,
    @Param('id') id: string,
    @Body() dto: OcorrenciaDto,
  ) {
    return this.service.adicionarOcorrencia(req.painel, id, dto.mensagem);
  }

  @Put('os/:id/laudo')
  @ApiOperation({ summary: 'Gravar ou editar o laudo técnico da OS' })
  async salvarLaudo(
    @Req() req: RequestComPainel,
    @Param('id') id: string,
    @Body() dto: LaudoDto,
  ) {
    return this.service.salvarLaudo(req.painel, id, {
      causa: dto.causa,
      servicoFeito: dto.servicoFeito,
      pendencias: dto.pendencias ?? null,
    });
  }

  @Post('os/:id/concluir')
  @ApiOperation({ summary: 'Concluir a OS — exige laudo e nenhum apontamento aberto' })
  async concluir(@Req() req: RequestComPainel, @Param('id') id: string) {
    return this.service.concluir(req.painel, id);
  }
}
