import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { OcorrenciasService } from './ocorrencias.service';

@ApiTags('ocorrencias')
@Controller('ocorrencias')
export class OcorrenciasController {
  constructor(private readonly service: OcorrenciasService) {}

  @Get('solicitacao/:solicitacaoOsId')
  @ApiOperation({
    summary: 'Histórico de ocorrências da O.S.',
    description:
      'Linha do tempo derivada da solicitação, orçamentos (ordensServico) ' +
      'e checklists de devolução (CHD) vinculados à O.S.',
  })
  @ApiParam({ name: 'solicitacaoOsId' })
  listarPorSolicitacao(@Param('solicitacaoOsId') solicitacaoOsId: string) {
    return this.service.listarPorSolicitacao(solicitacaoOsId);
  }
}
