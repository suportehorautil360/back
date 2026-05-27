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
import { EscalaService } from './escala.service';
import { UpsertEscalaDto } from './dto/upsert-escala.dto';

@ApiTags('escala')
@Controller('escala')
export class EscalaController {
  constructor(private readonly escalaService: EscalaService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Criar/atualizar a escala (jornada) da prefeitura' })
  @ApiOkResponse({ description: 'Escala salva.' })
  async salvar(@Body() dto: UpsertEscalaDto) {
    return this.escalaService.salvar(dto);
  }

  @Get(':prefeituraId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Obter a escala da prefeitura' })
  @ApiParam({ name: 'prefeituraId', description: 'ID da prefeitura' })
  @ApiOkResponse({ description: 'Escala da prefeitura (ou null).' })
  async obter(@Param('prefeituraId') prefeituraId: string) {
    return this.escalaService.obter(prefeituraId);
  }
}
