import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { HistoricoResponse } from './historico.types';
import { HistoricoService } from './historico.service';

@ApiTags('historico')
@Controller('historico')
export class HistoricoController {
  constructor(private readonly service: HistoricoService) {}

  @Get(':prefeituraId')
  @ApiOperation({ summary: 'Histórico de movimentações da prefeitura' })
  @ApiParam({ name: 'prefeituraId' })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Máximo de registros retornados (padrão 50, máximo 200)',
    example: 50,
  })
  @ApiOkResponse({
    description: 'Histórico carregado com sucesso',
    schema: {
      example: {
        summary: {
          totalLitersToday: 2840,
          totalAbastecimentosToday: 11,
          totalEngraxeToday: 4,
        },
        groups: [
          {
            dateLabel: 'HOJE · 03 JUN',
            items: [
              {
                id: 'uuid',
                tipo: 'abastecimento',
                plate: 'ABC-1234',
                equipmentLabel: 'Escavadeira · 4.812 h',
                rightLabel: '320 L',
                time: '14:20',
                createdAt: '2026-06-03T14:20:00.000Z',
              },
              {
                id: 'uuid',
                tipo: 'lubrificacao',
                plate: '9BWZZZ377',
                equipmentLabel: 'Pá carregadeira · 4 pontos',
                rightLabel: 'engraxe',
                time: '13:55',
                createdAt: '2026-06-03T13:55:00.000Z',
              },
            ],
          },
        ],
        message: 'Histórico carregado com sucesso!',
      },
    },
  })
  async listarPorPrefeitura(
    @Param('prefeituraId') prefeituraId: string,
    @Query('limit') limit?: string,
  ): Promise<HistoricoResponse> {
    const parsedLimit = Math.min(Number(limit) || 50, 200);
    return this.service.listarPorPrefeitura(prefeituraId, parsedLimit);
  }
}
