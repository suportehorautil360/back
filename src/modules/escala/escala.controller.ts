import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ConfiguracoesService } from '../configuracoes/configuracoes.service';

@ApiTags('escala')
@Controller('escala')
export class EscalaController {
  constructor(private readonly configuracoes: ConfiguracoesService) {}

  @Get(':prefeituraId')
  @ApiOperation({ summary: 'Obter escala da jornada da prefeitura' })
  @ApiParam({ name: 'prefeituraId' })
  async obter(@Param('prefeituraId') prefeituraId: string) {
    return this.configuracoes.obterEscala(prefeituraId);
  }
}
