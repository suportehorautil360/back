import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CargosPermissaoService } from './cargos-permissao.service';
import { UpsertCargosPermissaoDto } from './dto/upsert-cargos-permissao.dto';

@ApiTags('cargos-permissao')
@Controller('cargos-permissao')
export class CargosPermissaoController {
  constructor(private readonly service: CargosPermissaoService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Salvar mapa cargo → grupos da sidebar de uma prefeitura',
  })
  @ApiOkResponse({ description: 'Permissões salvas.' })
  async salvar(@Body() dto: UpsertCargosPermissaoDto) {
    return this.service.salvar(dto);
  }

  @Get(':prefeituraId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Obter mapa cargo → grupos (defaults se ainda não configurado)',
  })
  @ApiParam({ name: 'prefeituraId', description: 'ID da prefeitura' })
  @ApiOkResponse({ description: 'Mapa porCargo.' })
  async obter(@Param('prefeituraId') prefeituraId: string) {
    return {
      data: { porCargo: await this.service.obter(prefeituraId) },
      message: 'ok',
    };
  }
}
