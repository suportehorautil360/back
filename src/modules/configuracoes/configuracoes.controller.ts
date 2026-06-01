import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam } from '@nestjs/swagger';
import { ConfiguracoesService } from './configuracoes.service';
import { UpsertConfiguracaoDto } from './dto/upsert-configuracao.dto';

@ApiTags('configuracoes')
@Controller('configuracoes')
export class ConfiguracoesController {
  constructor(private readonly service: ConfiguracoesService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Criar/atualizar configuração da prefeitura' })
  async salvar(@Body() dto: UpsertConfiguracaoDto) {
    return this.service.salvar(dto);
  }

  @Get(':prefeituraId')
  @ApiOperation({ summary: 'Obter configuração da prefeitura' })
  @ApiParam({ name: 'prefeituraId' })
  async obter(@Param('prefeituraId') prefeituraId: string) {
    return this.service.obter(prefeituraId);
  }
}
