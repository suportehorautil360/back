import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { AbonosService } from './abonos.service';

@ApiTags('abonos')
@Controller('abonos')
export class AbonosController {
  constructor(private readonly service: AbonosService) {}

  @Get(':prefeituraId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar abonos ativos por prefeitura' })
  @ApiParam({ name: 'prefeituraId' })
  @ApiOkResponse({ description: 'Lista de abonos (vazia se nada).' })
  async listar(@Param('prefeituraId') prefeituraId: string) {
    return this.service.listar(prefeituraId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancelar um abono (ação do gestor)' })
  @ApiParam({ name: 'id' })
  async remover(@Param('id') id: string) {
    return this.service.remover(id);
  }
}
