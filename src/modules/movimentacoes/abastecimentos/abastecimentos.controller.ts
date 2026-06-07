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
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CreateAbastecimentoDto } from './dto/create-abastecimento.dto';
import { AbastecimentosService } from './abastecimentos.service';

@ApiTags('abastecimentos')
@Controller('abastecimentos')
export class AbastecimentosController {
  constructor(private readonly service: AbastecimentosService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Criar abastecimento' })
  async create(@Body() dto: CreateAbastecimentoDto) {
    const data = await this.service.create(dto);
    return { data, message: 'Abastecimento criado com sucesso!' };
  }

  @Get(':prefeituraId')
  @ApiOperation({ summary: 'Listar abastecimentos da prefeitura' })
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
  async listar(
    @Param('prefeituraId') prefeituraId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.service.listar(prefeituraId, startDate, endDate);
  }
}
