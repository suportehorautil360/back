import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { CreateLubrificacaoDto } from './dto/create-lubrificacao.dto';
import { LubrificacaoListItem } from './lubrificacoes.types';
import { LubrificacoesService } from './lubrificacoes.service';
import { IdempotencyInterceptor } from '../../../common/idempotency.interceptor';

@ApiTags('lubrificacoes')
@Controller('lubrificacoes')
export class LubrificacoesController {
  constructor(private readonly service: LubrificacoesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Criar lubrificação' })
  async create(@Body() dto: CreateLubrificacaoDto) {
    const data = await this.service.create(dto);
    return { data, message: 'Lubrificação criada com sucesso!' };
  }

  @Get(':prefeituraId')
  @ApiOperation({ summary: 'Listar lubrificações da prefeitura' })
  @ApiParam({ name: 'prefeituraId' })
  @ApiQuery({
    name: 'startDate',
    required: false,
    description: 'Início do período (ISO 8601 ou YYYY-MM-DD)',
    example: '2026-06-01',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    description: 'Fim do período (ISO 8601 ou YYYY-MM-DD)',
    example: '2026-06-30',
  })
  @ApiOkResponse({
    description: 'Lubrificações buscadas com sucesso',
    schema: {
      example: {
        data: [
          {
            id: '2f3bb1c6-0f83-4cf4-9b75-78d1d0bbd2fd',
            dateTime: '04/06, 10:20',
            vehicle: {
              name: 'Escavadeira CAT 320',
              plate: 'ABC-1234',
              type: 'Máquina',
            },
            reading: '1.840 h',
            greasedPoints: ['boomPins', 'bucket'],
            observation: 'Ponto da lança seco',
            local: 'Talhão 14',
            createdAt: '2026-06-04T10:20:00.000Z',
          },
        ],
        message: 'Lubrificações buscadas com sucesso!',
      },
    },
  })
  async listarPorPrefeitura(
    @Param('prefeituraId') prefeituraId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<{ data: LubrificacaoListItem[]; message: string }> {
    return this.service.listarPorPrefeitura(prefeituraId, startDate, endDate);
  }
}
