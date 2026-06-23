import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ChecklistChegadaService } from './checklist-chegada.service';
import { CreateChecklistChegadaDto } from './dto/create-checklist-chegada.dto';
import { UpdateChecklistChegadaFotosDto } from './dto/update-checklist-chegada-fotos.dto';

@ApiTags('checklist-chegada')
@Controller('checklist-chegada')
export class ChecklistChegadaController {
  constructor(private readonly service: ChecklistChegadaService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Registrar checklist de chegada do equipamento na oficina',
    description:
      'Grava em checklistsChegada com id (UUID) e createdAt gerados pelo back. ' +
      'Fotos devem ser URLs (upload prévio via /uploads).',
  })
  @ApiResponse({ status: 201, description: 'Checklist salvo.' })
  async criar(@Body() dto: CreateChecklistChegadaDto) {
    const data = await this.service.criar(dto);
    return {
      data,
      message: 'Checklist de chegada registrado com sucesso.',
    };
  }

  @Patch(':id/fotos')
  @ApiOperation({
    summary: 'Atualizar URLs das fotos após upload',
    description:
      'Use após POST /checklist-chegada e uploads em /uploads/foto com checklistId = id retornado.',
  })
  async atualizarFotos(
    @Param('id') id: string,
    @Body() dto: UpdateChecklistChegadaFotosDto,
  ) {
    const data = await this.service.atualizarFotos(id, dto);
    return {
      data,
      message: 'Fotos do checklist atualizadas com sucesso.',
    };
  }

  @Get('oficina/:oficinaId')
  @ApiOperation({ summary: 'Listar checklists de chegada da oficina' })
  @ApiParam({ name: 'oficinaId' })
  listarPorOficina(@Param('oficinaId') oficinaId: string) {
    return this.service.listarPorOficina(oficinaId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obter checklist de chegada por id' })
  @ApiParam({ name: 'id' })
  async obter(@Param('id') id: string) {
    const data = await this.service.obter(id);
    return {
      data,
      message: 'Checklist de chegada encontrado.',
    };
  }
}
