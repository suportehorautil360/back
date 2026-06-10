import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ClientesService } from './clientes.service';
import { CreateClienteDto } from './dto/create-cliente.dto';
import { CreateAcessoDto } from './dto/create-acesso.dto';

@ApiTags('clientes')
@Controller('clientes')
export class ClientesController {
  constructor(private readonly clientesService: ClientesService) {}

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
