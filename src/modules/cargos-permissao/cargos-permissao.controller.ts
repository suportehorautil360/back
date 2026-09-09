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
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { UpsertCargosPermissaoDto } from './dto/upsert-cargos-permissao.dto';

@ApiTags('cargos-permissao')
/**
 * Superfície herdada do 360, sem cliente vivo: nenhum app nem o painel chamam
 * estas rotas hoje (levantado em 09/09/2026, lendo os repositórios clientes).
 *
 * Estava aberta — qualquer um na internet chamava. `JwtAuthGuard` exige token
 * emitido pelo back; é o mínimo, e não substitui a checagem de a qual empresa
 * o portador pertence, que estas rotas ainda não fazem.
 */
@Controller('cargos-permissao')
@UseGuards(JwtAuthGuard)
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
