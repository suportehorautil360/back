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
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ChecklistDefinitionsService } from './checklist-definitions.service';
import { CreateChecklistDefinitionDto } from './dto/create-checklist-definition.dto';
import { UpdateChecklistDefinitionDto } from './dto/update-checklist-definition.dto';

@ApiTags('checklist-definitions')
@Controller('checklist-definitions')
export class ChecklistDefinitionsController {
  constructor(private readonly service: ChecklistDefinitionsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar definições de checklist (catálogo global)' })
  @ApiQuery({
    name: 'ativo',
    required: false,
    description: 'Se "true", retorna apenas as definições ativas.',
    example: 'true',
  })
  async findAll(@Query('ativo') ativo?: string) {
    return this.service.findAll(ativo === 'true');
  }

  @Post('seed')
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
  @ApiOperation({ summary: 'Buscar uma definição pelo ID' })
  @ApiParam({ name: 'id', description: 'ID/slug da definição' })
  async findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Criar uma definição de checklist' })
  async create(@Body() dto: CreateChecklistDefinitionDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
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
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Desativar uma definição (soft-delete)' })
  @ApiParam({ name: 'id', description: 'ID/slug da definição' })
  async delete(@Param('id') id: string) {
    return this.service.deleteById(id);
  }
}
