import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CreateCreditoDto } from './dto/create-credito.dto';
import { CreditosService } from './creditos.service';

@ApiTags('creditos')
@Controller('creditos')
export class CreditosController {
  constructor(private readonly service: CreditosService) {}

  @Get('opcoes/:prefeituraId')
  @ApiOperation({
    summary: 'Opções do formulário Adicionar crédito',
    description:
      'Retorna listas para o toggle Equipamento/Frente de trabalho, responsáveis e valores sugeridos.',
  })
  @ApiParam({ name: 'prefeituraId' })
  listarOpcoes(@Param('prefeituraId') prefeituraId: string) {
    return this.service.listarOpcoesFormulario(prefeituraId);
  }

  @Get('saldos/:prefeituraId')
  @ApiOperation({
    summary: 'Saldos de crédito por equipamento e frente de trabalho',
    description:
      'Retorna creditado, gasto e saldo. Gasto = soma dos valores (R$) de abastecimentos com total informado.',
  })
  @ApiParam({ name: 'prefeituraId' })
  listarSaldos(@Param('prefeituraId') prefeituraId: string) {
    return this.service.listarSaldos(prefeituraId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Lançar crédito' })
  async create(@Body() dto: CreateCreditoDto) {
    const data = await this.service.create(dto);
    return { data, message: 'Crédito lançado com sucesso!' };
  }

  @Get(':prefeituraId')
  @ApiOperation({ summary: 'Listar créditos da prefeitura' })
  @ApiParam({ name: 'prefeituraId' })
  listarPorPrefeitura(@Param('prefeituraId') prefeituraId: string) {
    return this.service.listarPorPrefeitura(prefeituraId);
  }
}
