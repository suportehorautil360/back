import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ParceirosService } from './parceiros.service';

@ApiTags('parceiros')
@Controller('parceiros')
export class ParceirosController {
  constructor(private readonly parceirosService: ParceirosService) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Rede de parceiros credenciados (postos e oficinas)',
    description:
      'Lista todos os postos e oficinas de todos os clientes, com a ' +
      'cidade/UF derivada do cliente vinculado.',
  })
  @ApiResponse({ status: 200, description: 'Postos e oficinas credenciados.' })
  async overview() {
    return this.parceirosService.overview();
  }
}
