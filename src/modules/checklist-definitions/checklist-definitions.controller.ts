import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';

import {
  EmpresaDoTokenGuard,
  type RequestComEmpresaOpcional,
} from '../../common/empresa-do-token.guard';
import { PainelGuard } from '../../common/painel.guard';
import { ChecklistDefinitionsService } from './checklist-definitions.service';
import { CreateChecklistDefinitionDto } from './dto/create-checklist-definition.dto';
import { UpdateChecklistDefinitionDto } from './dto/update-checklist-definition.dto';

@ApiTags('checklist-definitions')
@Controller('checklist-definitions')
export class ChecklistDefinitionsController {
  constructor(private readonly service: ChecklistDefinitionsService) {}

  /**
   * Aberta de propósito, e recortada por isso.
   *
   * O login por CHASSI do operador não tem credencial — o chassi identifica
   * uma máquina, não uma pessoa —, então exigir token aqui derrubaria um fluxo
   * legítimo de campo. Quem não se identifica recebe o catálogo BASE e só ele;
   * quem manda token recebe também o da empresa dele.
   */
  @Get()
  @UseGuards(EmpresaDoTokenGuard)
  @ApiOperation({
    summary: 'Listar definições — base, mais as da empresa quando há token',
  })
  @ApiQuery({
    name: 'ativo',
    required: false,
    description: 'Se "true", retorna apenas as definições ativas.',
    example: 'true',
  })
  async findAll(
    @Req() req: RequestComEmpresaOpcional,
    @Query('ativo') ativo?: string,
  ) {
    return this.service.findAll(ativo === 'true', req.companyIdOpcional);
  }

  @Post('seed')
  @UseGuards(PainelGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Bootstrap idempotente do catálogo a partir do seed',
  })
  @ApiQuery({
    name: 'force',
    required: false,
    description: 'Se "true", regrava as definições do seed mesmo já populado.',
    example: 'false',
  })
  async seed(@Query('force') force?: string) {
    return this.service.seedDefaults(force === 'true');
  }

  @Get(':id')
  @UseGuards(PainelGuard)
  @ApiOperation({ summary: 'Buscar uma definição pelo ID' })
  @ApiParam({ name: 'id', description: 'ID/slug da definição' })
  async findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Post()
  @UseGuards(PainelGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Criar uma definição de checklist' })
  async create(@Body() dto: CreateChecklistDefinitionDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @UseGuards(PainelGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Atualizar uma definição (parcial)' })
  @ApiParam({ name: 'id', description: 'ID/slug da definição' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateChecklistDefinitionDto,
  ) {
    return this.service.updateById(id, dto);
  }

  @Delete(':id')
  @UseGuards(PainelGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Desativar uma definição (soft-delete)' })
  @ApiParam({ name: 'id', description: 'ID/slug da definição' })
  async delete(@Param('id') id: string) {
    return this.service.deleteById(id);
  }
}
