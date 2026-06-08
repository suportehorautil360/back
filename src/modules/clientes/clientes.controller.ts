import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ClientesService } from './clientes.service';

@ApiTags('clientes')
@Controller('clientes')
export class ClientesController {
  constructor(private readonly clientesService: ClientesService) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Visão geral dos clientes contratantes',
    description:
      'Lista os clientes com métricas agregadas por cliente (frota ativa, ' +
      'em manutenção e checklists). Custo e O.S. retornam zerados por ora.',
  })
  @ApiResponse({ status: 200, description: 'Lista de clientes com métricas.' })
  async overview() {
    return this.clientesService.overview();
  }
}
