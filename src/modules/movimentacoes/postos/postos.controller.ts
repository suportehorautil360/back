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
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { CreatePostoDto } from './dto/create-posto.dto';
import { PostosService } from './postos.service';
import { PostoListItem } from './postos.types';

@ApiTags('postos')
@Controller('postos')
export class PostosController {
  constructor(private readonly service: PostosService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Cadastrar posto ou oficina parceira' })
  async create(@Body() dto: CreatePostoDto) {
    const data = await this.service.create(dto);
    return { data, message: 'Posto cadastrado com sucesso!' };
  }

  @Get(':prefeituraId')
  @ApiOperation({ summary: 'Listar postos credenciados da prefeitura' })
  @ApiParam({ name: 'prefeituraId' })
  @ApiQuery({
    name: 'startDate',
    required: false,
    description: 'Início do período para métricas de abastecimento',
    example: '2026-06-01',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    description: 'Fim do período para métricas de abastecimento',
    example: '2026-06-30',
  })
  @ApiOkResponse({
    description: 'Postos buscados com sucesso',
    schema: {
      example: {
        data: [
          {
            id: 'uuid-posto-1',
            code: 'P1',
            name: 'Posto Trevo BR-153',
            endereco: 'Rod. BR-153, km 42',
            precoPorLitro: 6.12,
            precoPorLitroLabel: 'R$ 6,12',
            abastecimentos: 3,
            totalLitros: 140,
            totalLitrosLabel: '140 L',
            totalGasto: 856.8,
            totalGastoLabel: 'R$ 856,80',
            razaoSocial: 'Posto Trevo Ltda',
            cnpj: '00.000.000/0001-00',
            telefonePrincipal: '(19) 99999-9999',
            emailComercial: 'contato@posto.com',
            cidadeUf: 'Campinas/SP',
            tipoParceiro: 'posto',
            createdAt: '2026-06-01T10:00:00.000Z',
          },
        ],
        message: 'Postos buscados com sucesso!',
      },
    },
  })
  listarPorPrefeitura(
    @Param('prefeituraId') prefeituraId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<{ data: PostoListItem[]; message: string }> {
    return this.service.listarPorPrefeitura(prefeituraId, startDate, endDate);
  }
}
