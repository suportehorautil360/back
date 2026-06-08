import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ParceirosService } from './parceiros.service';
import { CreateParceiroDto } from './dto/create-parceiro.dto';

@ApiTags('parceiros')
@Controller('parceiros')
export class ParceirosController {
  constructor(private readonly parceirosService: ParceirosService) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Rede de parceiros credenciados (postos e oficinas)',
    description:
      'Lista todos os postos e oficinas de todos os clientes, com a ' +
      'cidade/UF do parceiro (ou derivada do cliente vinculado).',
  })
  @ApiResponse({ status: 200, description: 'Postos e oficinas credenciados.' })
  async overview() {
    return this.parceirosService.overview();
  }

  @Post()
  @ApiOperation({ summary: 'Cadastrar parceiro (posto ou oficina)' })
  @ApiResponse({ status: 201, description: 'Parceiro cadastrado.' })
  async criar(@Body() dto: CreateParceiroDto) {
    return this.parceirosService.criar(dto);
  }

  @Delete(':tipo/:id')
  @ApiOperation({ summary: 'Remover parceiro (posto/oficina) pelo id' })
  async remover(@Param('tipo') tipo: string, @Param('id') id: string) {
    return this.parceirosService.remover(tipo, id);
  }
}
