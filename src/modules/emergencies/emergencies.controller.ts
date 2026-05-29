import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CreateEmergencyDto } from './dto/create-emergency.dto';
import { UpdateEmergencyStatusDto } from './dto/update-emergency-status.dto';
import { EmergenciesService } from './emergencies.service';

@ApiTags('emergencies')
@Controller('emergencies')
export class EmergenciesController {
  constructor(private readonly service: EmergenciesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Registrar emergência manual ou automática' })
  async create(@Body() dto: CreateEmergencyDto) {
    return this.service.create(dto);
  }

  @Get(':prefeituraId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar emergências por prefeitura' })
  @ApiParam({ name: 'prefeituraId', description: 'ID da prefeitura' })
  async listByPrefeitura(@Param('prefeituraId') prefeituraId: string) {
    return this.service.listByPrefeitura(prefeituraId);
  }

  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Atualizar status de atendimento da emergência' })
  @ApiParam({ name: 'id', description: 'ID da emergência' })
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateEmergencyStatusDto,
  ) {
    return this.service.updateStatus(id, dto.status);
  }
}
