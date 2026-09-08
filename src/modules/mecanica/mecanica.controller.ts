import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PainelGuard, type RequestComPainel } from '../../common/painel.guard';
import { MecanicaService } from './mecanica.service';
import {
  EditarApontamentoDto,
  LancarApontamentoDto,
} from './dto/apontamento.dto';

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
}
