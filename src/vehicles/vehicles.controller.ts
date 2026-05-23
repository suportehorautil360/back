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

// O texto 'vehicles' aqui define a URL da rota: http://localhost:3000/vehicles
@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly vehiclesService: VehiclesService) {}

  @Post()
  async create(@Body() createVehicleDto: CreateVehicleDto) {
    return this.vehiclesService.create(createVehicleDto);
  }

  @Get(':id')
  async findAll(@Param('id') id: string) {
    return this.vehiclesService.findAllByID(id);
  }

  @Post('update/:carId')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('carId') carId: string,
    @Body() updateVehicleDto: CreateVehicleDto,
  ) {
    return this.vehiclesService.updateById(carId, updateVehicleDto);
  }

  @Delete(':carId')
  @HttpCode(HttpStatus.OK)
  async delete(@Param('carId') carId: string) {
    return this.vehiclesService.deleteById(carId);
  }
}
