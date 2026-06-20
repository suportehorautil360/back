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
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CreateSolicitacaoDto } from './dto/create-solicitacao.dto';
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
