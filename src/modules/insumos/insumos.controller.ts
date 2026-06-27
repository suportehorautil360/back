import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { InsumosService } from './insumos.service';

@ApiTags('insumos')
@Controller('insumos')
export class InsumosController {
  constructor(private readonly service: InsumosService) {}

  @Get('solicitacao/:solicitacaoOsId')
  @ApiOperation({
    summary: 'Insumos da O.S. (orçamento)',
    description:
      'Peças e materiais a partir dos itens de orçamento (ordensServico) ' +
      'vinculados à solicitação. Exclui serviço e deslocamento.',
  })
  @ApiParam({ name: 'solicitacaoOsId' })
  listarPorSolicitacao(@Param('solicitacaoOsId') solicitacaoOsId: string) {
    return this.service.listarPorSolicitacao(solicitacaoOsId);
  }
}
