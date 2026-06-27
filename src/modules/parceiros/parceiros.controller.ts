import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ParceirosService } from './parceiros.service';
import { CreateParceiroDto } from './dto/create-parceiro.dto';
import {
  CreateParceiroLoginDto,
  ResetParceiroLoginSenhaDto,
} from './dto/create-parceiro-login.dto';

@ApiTags('parceiros')
@Controller('parceiros')
export class ParceirosController {
  constructor(private readonly parceirosService: ParceirosService) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Rede de parceiros credenciados (postos e oficinas)',
    description:
      'Lista todos os postos e oficinas de todos os clientes, com a ' +
      'cidade/UF do parceiro (ou derivada do cliente vinculado).',
  })
  @ApiResponse({ status: 200, description: 'Postos e oficinas credenciados.' })
  async overview(@Query('prefeituraId') prefeituraId?: string) {
    return this.parceirosService.overview(prefeituraId);
  }

  @Post()
  @ApiOperation({ summary: 'Cadastrar parceiro (posto ou oficina)' })
  @ApiResponse({ status: 201, description: 'Parceiro cadastrado.' })
  async criar(@Body() dto: CreateParceiroDto) {
    return this.parceirosService.criar(dto);
  }

  /** Rotas de login antes de `:tipo/:id` — senão DELETE /logins/:id cai em remover parceiro. */
  @Patch('logins/:acessoId/senha')
  @ApiOperation({ summary: 'Redefinir senha de um login operacional' })
  resetarLoginSenha(
    @Param('acessoId') acessoId: string,
    @Body() dto: ResetParceiroLoginSenhaDto,
  ) {
    return this.parceirosService.resetarLoginSenha(acessoId, dto);
  }

  @Delete('logins/:acessoId')
  @ApiOperation({ summary: 'Remover login operacional' })
  removerLogin(@Param('acessoId') acessoId: string) {
    return this.parceirosService.removerLogin(acessoId);
  }

  @Get(':tipo/:parceiroId/logins')
  @ApiOperation({ summary: 'Listar logins operacionais do posto ou oficina' })
  @ApiParam({ name: 'tipo', enum: ['posto', 'oficina'] })
  @ApiParam({ name: 'parceiroId' })
  listarLogins(
    @Param('tipo') tipo: string,
    @Param('parceiroId') parceiroId: string,
  ) {
    return this.parceirosService.listarLogins(tipo, parceiroId);
  }

  @Post(':tipo/:parceiroId/logins')
  @ApiOperation({ summary: 'Criar login operacional para posto ou oficina' })
  @ApiParam({ name: 'tipo', enum: ['posto', 'oficina'] })
  @ApiParam({ name: 'parceiroId' })
  criarLogin(
    @Param('tipo') tipo: string,
    @Param('parceiroId') parceiroId: string,
    @Body() dto: CreateParceiroLoginDto,
  ) {
    return this.parceirosService.criarLogin(tipo, parceiroId, dto);
  }

  @Delete(':tipo/:id')
  @ApiOperation({ summary: 'Remover parceiro (posto/oficina) pelo id' })
  async remover(@Param('tipo') tipo: string, @Param('id') id: string) {
    return this.parceirosService.remover(tipo, id);
  }
}
