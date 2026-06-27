import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { EquipamentosService } from './equipamentos.service';
import { CreateEquipamentoDto } from './dto/create-equipamento.dto';
import { UpdateEquipamentoDto } from './dto/update-equipamento.dto';
import { CompleteRevisaoEquipDto } from './dto/complete-revisao-equip.dto';
import { ComboistaGuard } from '../../common/comboista.guard';

@ApiTags('equipamentos')
@Controller('equipamentos')
export class EquipamentosController {
  constructor(private readonly equipamentosService: EquipamentosService) {}

  @Post()
  @ApiOperation({ summary: 'Criar um novo equipamento' })
  @ApiResponse({ status: 201, description: 'Equipamento criado com sucesso.' })
  async create(@Body() dto: CreateEquipamentoDto) {
    return this.equipamentosService.create(dto);
  }

  @Post('revision/complete')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Concluir revisão de um equipamento e liberá-lo',
    description:
      'Grava a revisão como concluída, adota a leitura informada como atual e ' +
      'base da próxima revisão, e devolve o equipamento para o status ativo.',
  })
  async completeRevision(@Body() dto: CompleteRevisaoEquipDto) {
    return this.equipamentosService.completeRevision(dto);
  }

  @Get('item/:id')
  @ApiOperation({ summary: 'Buscar um equipamento pelo ID' })
  @ApiParam({ name: 'id', description: 'ID do equipamento' })
  async findOne(@Param('id') id: string) {
    return this.equipamentosService.findById(id);
  }

  @Get('motorista/:prefeituraId/:motoristaId')
  @UseGuards(ComboistaGuard)
  @ApiOperation({
    summary:
      'Listar equipamentos em que o funcionário é condutor (FleetFuel motorista)',
  })
  @ApiParam({ name: 'prefeituraId', description: 'ID da prefeitura' })
  @ApiParam({
    name: 'motoristaId',
    description: 'ID do funcionário (condutor)',
  })
  async findEquipamentosMotorista(
    @Param('prefeituraId') prefeituraId: string,
    @Param('motoristaId') motoristaId: string,
  ) {
    return this.equipamentosService.findEquipamentosByMotorista(
      prefeituraId,
      motoristaId,
    );
  }

  @Get('comboios/:prefeituraId/:motoristaId')
  @UseGuards(ComboistaGuard)
  @ApiOperation({
    summary: 'Listar comboios em que o funcionário é condutor (com tanque)',
  })
  @ApiParam({ name: 'prefeituraId', description: 'ID da prefeitura' })
  @ApiParam({
    name: 'motoristaId',
    description: 'ID do funcionário (condutor)',
  })
  async findComboios(
    @Param('prefeituraId') prefeituraId: string,
    @Param('motoristaId') motoristaId: string,
  ) {
    return this.equipamentosService.findComboiosByMotorista(
      prefeituraId,
      motoristaId,
    );
  }

  @Get(':prefeituraId')
  @ApiOperation({ summary: 'Listar equipamentos de uma prefeitura' })
  @ApiParam({ name: 'prefeituraId', description: 'ID da prefeitura' })
  @ApiResponse({ status: 200, description: 'Lista de equipamentos.' })
  async findAll(@Param('prefeituraId') prefeituraId: string) {
    return this.equipamentosService.findAllByPrefeitura(prefeituraId);
  }

  @Post('update/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Atualizar um equipamento (parcial)' })
  @ApiParam({ name: 'id', description: 'ID do equipamento' })
  async update(@Param('id') id: string, @Body() dto: UpdateEquipamentoDto) {
    return this.equipamentosService.updateById(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remover um equipamento' })
  @ApiParam({ name: 'id', description: 'ID do equipamento' })
  async delete(@Param('id') id: string) {
    return this.equipamentosService.deleteById(id);
  }
}
