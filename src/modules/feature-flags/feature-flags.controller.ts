import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { FeatureFlagsService } from './feature-flags.service';
import { UpsertFeatureFlagsDto } from './dto/upsert-feature-flags.dto';

@ApiTags('feature-flags')
@Controller('feature-flags')
export class FeatureFlagsController {
  constructor(private readonly service: FeatureFlagsService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Salvar as funcionalidades de uma prefeitura' })
  @ApiOkResponse({ description: 'Funcionalidades salvas.' })
  async salvar(@Body() dto: UpsertFeatureFlagsDto) {
    return this.service.salvar(dto);
  }

  @Get(':prefeituraId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Obter as funcionalidades de uma prefeitura' })
  @ApiParam({ name: 'prefeituraId', description: 'ID da prefeitura' })
  @ApiOkResponse({ description: 'Mapa de flags (pode ser vazio).' })
  async obter(@Param('prefeituraId') prefeituraId: string) {
    return { data: await this.service.obter(prefeituraId), message: 'ok' };
  }
}
