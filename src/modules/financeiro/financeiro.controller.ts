import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { FinanceiroService } from './financeiro.service';
import { CreateLancamentoDto } from './dto/create-lancamento.dto';

@ApiTags('financeiro')
@Controller('financeiro')
export class FinanceiroController {
  constructor(private readonly financeiroService: FinanceiroService) {}

  @Get()
  @ApiOperation({
    summary: 'Contas a pagar e receber (lançamentos + resumo)',
  })
  @ApiResponse({ status: 200, description: 'Lançamentos e resumo financeiro.' })
  async listar() {
    return this.financeiroService.listar();
  }

  @Post()
  @ApiOperation({ summary: 'Criar lançamento financeiro' })
  @ApiResponse({ status: 201, description: 'Lançamento criado.' })
  async criar(@Body() dto: CreateLancamentoDto) {
    return this.financeiroService.criar(dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remover lançamento financeiro' })
  async remover(@Param('id') id: string) {
    return this.financeiroService.remover(id);
  }
}
