import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { SolicitacoesPontoService } from './solicitacoes-ponto.service';
import { CreateSolicitacaoPontoDto } from './dto/create-solicitacao-ponto.dto';
import { ReprovarSolicitacaoDto } from './dto/reprovar-solicitacao.dto';

@ApiTags('solicitacoes-ponto')
@Controller('solicitacoes-ponto')
export class SolicitacoesPontoController {
  constructor(private readonly service: SolicitacoesPontoService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Criar solicitação de ajuste de ponto (incluir / cancelar / abono / mensagem)',
  })
  @ApiInternalServerErrorResponse({
    description: 'Falha ao registrar a solicitação.',
  })
  async create(@Body() dto: CreateSolicitacaoPontoDto) {
    return this.service.create(dto);
  }

  @Get(':prefeituraId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar solicitações de ajuste por prefeitura' })
  @ApiParam({ name: 'prefeituraId', description: 'ID da prefeitura (tenant)' })
  @ApiOkResponse({ description: 'Lista de solicitações.' })
  async listar(@Param('prefeituraId') prefeituraId: string) {
    return this.service.listar(prefeituraId);
  }

  @Post(':id/aprovar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Aprovar uma solicitação (cria batida em "incluir", cancela em "cancelar")',
  })
  @ApiParam({ name: 'id', description: 'ID da solicitação' })
  async aprovar(@Param('id') id: string) {
    return this.service.aprovar(id);
  }

  @Post(':id/reprovar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reprovar uma solicitação com motivo' })
  @ApiParam({ name: 'id', description: 'ID da solicitação' })
  async reprovar(@Param('id') id: string, @Body() dto: ReprovarSolicitacaoDto) {
    return this.service.reprovar(id, dto.motivo);
  }
}
