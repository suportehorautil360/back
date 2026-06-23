import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CreateOrcamentoDto } from './dto/create-orcamento.dto';
import { OrcamentosService } from './orcamentos.service';

@ApiTags('os')
@Controller('os/orcamentos')
export class OrcamentosController {
  constructor(private readonly service: OrcamentosService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Oficina envia orçamento para uma OS',
    description:
      'Grava ordensServico, adiciona lance em solicitacoesOS e avança status para em_orcamento ou pregao.',
  })
  @ApiResponse({ status: 201, description: 'Orçamento enviado.' })
  async criar(@Body() dto: CreateOrcamentoDto) {
    const data = await this.service.criar(dto);
    return {
      data,
      message: 'Orçamento enviado com sucesso.',
    };
  }

  @Get('oficina/:oficinaId')
  @ApiOperation({
    summary: 'Listar orçamentos enviados pela oficina',
    description:
      'Lê a coleção ordensServico com itens (peças, serviços, deslocamento) gravados no POST.',
  })
  @ApiParam({ name: 'oficinaId' })
  listarPorOficina(@Param('oficinaId') oficinaId: string) {
    return this.service.listarPorOficina(oficinaId);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Obter orçamento por id',
    description:
      'Aceita id de ordensServico ou solicitacaoOsId (com oficinaId na query quando necessário).',
  })
  @ApiParam({ name: 'id' })
  @ApiQuery({ name: 'oficinaId', required: false })
  obter(
    @Param('id') id: string,
    @Query('oficinaId') oficinaId?: string,
  ) {
    return this.service.obterPorId(id, oficinaId);
  }
}
