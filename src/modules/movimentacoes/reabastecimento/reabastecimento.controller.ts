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
import { CreateReabastecimentoDto } from './dto/create-reabastecimento.dto';
import {
  ReabastecimentoListItem,
  ReabastecimentoService,
} from './reabastecimento.service';
import { IdempotencyInterceptor } from '../../../common/idempotency.interceptor';

@ApiTags('reabastecimentos')
@Controller('reabastecimentos')
export class ReabastecimentoController {
  constructor(private readonly service: ReabastecimentoService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Criar reabastecimento' })
  async create(@Body() dto: CreateReabastecimentoDto) {
    const data = await this.service.create(dto);
    return { data, message: 'Reabastecimento criado com sucesso!' };
  }

  @Get(':prefeituraId')
  @ApiOperation({ summary: 'Listar reabastecimentos da prefeitura' })
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
    description: 'Reabastecimentos buscados com sucesso',
    schema: {
      example: {
        data: [
          {
            id: 'rea-f73395f4-bfef-4da5-b1e8-922e0fbe74c2-mobile-001',
            dateTime: '04/06, 10:20',
            sourceType: 'farmTank',
            receivedLiters: 320,
            invoiceNumber: 'NF 0455123',
            createdAt: '2026-06-04T10:20:00.000Z',
          },
        ],
        message: 'Reabastecimentos buscados com sucesso!',
      },
    },
  })
  listarPorPrefeitura(
    @Param('prefeituraId') prefeituraId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<{ data: ReabastecimentoListItem[]; message: string }> {
    return this.service.listarPorPrefeitura(prefeituraId, startDate, endDate);
  }
}
