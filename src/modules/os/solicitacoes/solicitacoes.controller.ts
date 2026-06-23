import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { AprovarSolicitacaoDto } from './dto/aprovar-solicitacao.dto';
import { CreateSolicitacaoDto } from './dto/create-solicitacao.dto';
import { ListSolicitacoesOficinaQueryDto } from './dto/list-solicitacoes-oficina-query.dto';
import { ListSolicitacoesQueryDto } from './dto/list-solicitacoes-query.dto';
import { SolicitacoesService } from './solicitacoes.service';

@ApiTags('os')
@Controller('os/solicitacoes')
export class SolicitacoesController {
  constructor(private readonly service: SolicitacoesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create service order request',
    description:
      'Creates solicitacoesOS, selects up to 3 active workshops by equipment line, and generates a unique protocol.',
  })
  async create(@Body() dto: CreateSolicitacaoDto) {
    const data = await this.service.create(dto);
    return {
      data,
      message: 'Service order request created successfully.',
    };
  }

  @Patch(':solicitacaoId/aprovar')
  @ApiOperation({
    summary: 'Approve a workshop quote for a service order',
    description:
      'Approves one ordensServico, rejects other pending quotes, and sets solicitacao status to aprovado.',
  })
  @ApiParam({ name: 'solicitacaoId' })
  async aprovar(
    @Param('solicitacaoId') solicitacaoId: string,
    @Body() dto: AprovarSolicitacaoDto,
  ) {
    const data = await this.service.aprovar(
      solicitacaoId,
      dto.ordemServicoId,
    );
    return {
      data,
      message: 'Orçamento aprovado com sucesso.',
    };
  }

  @Get('oficina/:oficinaId')
  @ApiOperation({
    summary: 'List service order requests for a workshop',
    description:
      'Returns all solicitacoesOS where oficinaId is in oficinasIds (all phases). ' +
      'The app splits by tab using the status field. Optional query: status, prefeituraId, dates.',
  })
  @ApiParam({ name: 'oficinaId' })
  listByOficina(
    @Param('oficinaId') oficinaId: string,
    @Query() query: ListSolicitacoesOficinaQueryDto,
  ) {
    return this.service.listByOficina(oficinaId, query);
  }

  @Get(':prefeituraId/com-orcamentos')
  @ApiOperation({
    summary: 'List service order requests with workshop quotes',
    description:
      'Returns solicitacoesOS for the prefeitura with nested ordensServico (Orçamentos e Aprovações).',
  })
  @ApiParam({ name: 'prefeituraId' })
  listComOrcamentos(
    @Param('prefeituraId') prefeituraId: string,
    @Query() query: ListSolicitacoesQueryDto,
  ) {
    return this.service.listComOrcamentosByPrefeitura(prefeituraId, query);
  }

  @Get(':prefeituraId')
  @ApiOperation({
    summary: 'List service order requests by municipality',
    description:
      'Returns solicitacoesOS for the prefeitura. Optional filters: status, startDate, endDate (YYYY-MM-DD).',
  })
  @ApiParam({ name: 'prefeituraId' })
  listByPrefeitura(
    @Param('prefeituraId') prefeituraId: string,
    @Query() query: ListSolicitacoesQueryDto,
  ) {
    return this.service.listByPrefeitura(prefeituraId, query);
  }
}
