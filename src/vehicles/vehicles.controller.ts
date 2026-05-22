import { Controller, Post, Body } from '@nestjs/common';
import { VehiclesService } from './vehicles.service';
import { CreateVehicleDto } from './dto/create-vehicle.dto';

// O texto 'vehicles' aqui define a URL da rota: http://localhost:3000/vehicles
@Controller('vehicles')
export class VehiclesController {
  // Injetamos o Service para que o Controller possa usá-lo
  constructor(private readonly vehiclesService: VehiclesService) {}

  // O @Post() diz que essa função só responde a requisições do tipo POST (usadas para criar dados)
  @Post()
  async create(@Body() createVehicleDto: CreateVehicleDto) {
    // O @Body() pega os dados que vieram no corpo da requisição e joga na variável 'createVehicleDto'
    // Depois, repassamos isso para o serviço fazer o trabalho pesado
    return this.vehiclesService.create(createVehicleDto);
  }
}
