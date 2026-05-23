import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  HttpStatus,
  HttpCode,
  Delete,
} from '@nestjs/common';
import { VehiclesService } from './vehicles.service';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';

@ApiTags('vehicles')
@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly vehiclesService: VehiclesService) {}

  @ApiOperation({ summary: 'Criar um novo veículo' })
  @ApiResponse({ status: 201, description: 'Veículo criado com sucesso.' })
  @Post()
  async create(@Body() createVehicleDto: CreateVehicleDto) {
    return this.vehiclesService.create(createVehicleDto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Listar veículos de uma prefeitura' })
  @ApiParam({ name: 'id', description: 'ID único da prefeitura' })
  @ApiResponse({
    status: 200,
    description: 'Lista de veículos encontrada com sucesso.',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: { $ref: '#/components/schemas/CreateVehicleDto' },
        },
        message: {
          type: 'string',
          example: 'Veículos encontrados com sucesso!',
        },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Nenhum veículo encontrado.',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          example: 'Nenhum veículo encontrado para a prefeitura fornecida.',
        },
        error: { type: 'string', example: 'Not Found' },
        statusCode: { type: 'number', example: 404 },
      },
    },
  })
  async findAll(@Param('id') id: string) {
    return this.vehiclesService.findAllByID(id);
  }

  @Post('update/:carId')
  @ApiOperation({ summary: 'Atualizar dados de um veículo' })
  @ApiParam({ name: 'carId', description: 'ID do veículo a ser atualizado' })
  @ApiResponse({ status: 200, description: 'Veículo atualizado com sucesso.' })
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('carId') carId: string,
    @Body() updateVehicleDto: CreateVehicleDto,
  ) {
    return this.vehiclesService.updateById(carId, updateVehicleDto);
  }

  @Delete(':carId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remover um veículo' })
  @ApiParam({ name: 'carId', description: 'ID do veículo a ser removido' })
  @ApiResponse({
    status: 200,
    description: 'Veículo removido com sucesso.',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          example: 'Veículo removido com sucesso!',
        },
        data: { type: 'object', example: {} },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Nenhum veículo encontrado.',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          example: 'Nenhum veículo encontrado para a prefeitura fornecida.',
        },
        error: { type: 'string', example: 'Not Found' },
        statusCode: { type: 'number', example: 404 },
      },
    },
  })
  async delete(@Param('carId') carId: string) {
    return this.vehiclesService.deleteById(carId);
  }
}
