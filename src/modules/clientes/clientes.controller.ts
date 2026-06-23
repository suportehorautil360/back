import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ClientesOficinasService } from './clientes-oficinas.service';
import { ClientesService } from './clientes.service';
import { CreateClienteDto } from './dto/create-cliente.dto';
import { UpdateClienteDto } from './dto/update-cliente.dto';
import { CreateAcessoDto } from './dto/create-acesso.dto';

@ApiTags('clientes')
@Controller('clientes')
export class ClientesController {
  constructor(
    private readonly clientesService: ClientesService,
    private readonly clientesOficinasService: ClientesOficinasService,
  ) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Visão geral dos clientes contratantes',
    description:
      'Lista os clientes com métricas agregadas por cliente (frota ativa, ' +
      'em manutenção e checklists). Custo e O.S. retornam zerados por ora.',
  })
  @ApiResponse({ status: 200, description: 'Lista de clientes com métricas.' })
  async overview() {
    return this.clientesService.overview();
  }

  @Post()
  @ApiOperation({
    summary: 'Cadastrar cliente + contrato de prestação de serviços',
  })
  @ApiResponse({ status: 201, description: 'Cliente cadastrado.' })
  async criar(@Body() dto: CreateClienteDto) {
    return this.clientesService.criar(dto);
  }

  @Post('update/:clienteId')
  @ApiOperation({
    summary: 'Atualizar (parcial) os dados de um cliente / empresa',
    description:
      'Edição completa no admin ou só os dados da empresa pela tela de ' +
      'Configurações da prefeitura — fonte única (coleção clientes).',
  })
  @ApiResponse({ status: 200, description: 'Cliente atualizado.' })
  async atualizar(
    @Param('clienteId') clienteId: string,
    @Body() dto: UpdateClienteDto,
  ) {
    return this.clientesService.atualizar(clienteId, dto);
  }

  @Get(':prefeituraId/oficinas')
  @ApiOperation({
    summary: 'Oficinas credenciadas no município',
    description:
      'Lista oficinas com prefeituraId e status ativo — mesma fonte usada no sorteio da OS.',
  })
  @ApiParam({ name: 'prefeituraId' })
  listarOficinasCredenciadas(@Param('prefeituraId') prefeituraId: string) {
    return this.clientesOficinasService.listarCredenciadas(prefeituraId);
  }

  @Post(':prefeituraId/parceiros/:parceiroId/credenciar')
  @ApiOperation({
    summary: 'Credenciar oficina parceira no município',
    description:
      'Vincula parceiro global (coleção oficinas) ao prefeituraId para participar do sorteio de OS.',
  })
  @ApiParam({ name: 'prefeituraId' })
  @ApiParam({ name: 'parceiroId' })
  credenciarOficina(
    @Param('prefeituraId') prefeituraId: string,
    @Param('parceiroId') parceiroId: string,
  ) {
    return this.clientesOficinasService.credenciar(prefeituraId, parceiroId);
  }

  @Delete(':prefeituraId/parceiros/:parceiroId/descredenciar')
  @ApiOperation({
    summary: 'Descredenciar oficina do município',
    description: 'Define status Suspensa no credenciamento municipal (não remove o parceiro global).',
  })
  @ApiParam({ name: 'prefeituraId' })
  @ApiParam({ name: 'parceiroId' })
  descredenciarOficina(
    @Param('prefeituraId') prefeituraId: string,
    @Param('parceiroId') parceiroId: string,
  ) {
    return this.clientesOficinasService.descredenciar(prefeituraId, parceiroId);
  }

  @Get(':clienteId')
  @ApiOperation({
    summary: 'Dados de um cliente por id (= prefeituraId)',
    description:
      'Inclui os dados da empresa (cnpj, cidade, whatsapp, etc.) usados para ' +
      'pré-preencher a tela de Configurações da prefeitura.',
  })
  @ApiResponse({ status: 200, description: 'Cliente encontrado.' })
  async obter(@Param('clienteId') clienteId: string) {
    return this.clientesService.obter(clienteId);
  }

  @Get(':clienteId/acessos')
  @ApiOperation({
    summary: 'Lista os acessos (usuários) vinculados ao cliente',
  })
  async listarAcessos(@Param('clienteId') clienteId: string) {
    return this.clientesService.listarAcessos(clienteId);
  }

  @Post(':clienteId/acessos')
  @ApiOperation({ summary: 'Cria um acesso (usuário) vinculado ao cliente' })
  @ApiResponse({ status: 201, description: 'Acesso criado.' })
  async criarAcesso(
    @Param('clienteId') clienteId: string,
    @Body() dto: CreateAcessoDto,
  ) {
    return this.clientesService.criarAcesso(clienteId, dto);
  }

  @Delete(':clienteId/acessos/:acessoId')
  @ApiOperation({ summary: 'Remove um acesso (usuário)' })
  async removerAcesso(@Param('acessoId') acessoId: string) {
    return this.clientesService.removerAcesso(acessoId);
  }
}
