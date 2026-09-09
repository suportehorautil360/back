import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { FinanceiroService } from './financeiro.service';
import { CreateLancamentoDto } from './dto/create-lancamento.dto';

@ApiTags('financeiro')
/**
 * Superfície herdada do 360, sem cliente vivo: nenhum app nem o painel chamam
 * estas rotas hoje (levantado em 09/09/2026, lendo os repositórios clientes).
 *
 * Estava aberta — qualquer um na internet chamava. `JwtAuthGuard` exige token
 * emitido pelo back; é o mínimo, e não substitui a checagem de a qual empresa
 * o portador pertence, que estas rotas ainda não fazem.
 */
@Controller('financeiro')
@UseGuards(JwtAuthGuard)
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
