import { ApiProperty } from '@nestjs/swagger';

export class CreateVehicleDto {
  @ApiProperty({
    description: 'Nome ou apelido do veículo',
    example: 'Caminhão Coleta 01',
  })
  name!: string;

  @ApiProperty({
    description: 'Placa do veículo',
    example: 'ABC-1234',
  })
  plate!: string;

  @ApiProperty({
    description: 'Tipo do veículo (ex: caminhão, carro)',
    example: 'caminhão',
  })
  type!: string;

  @ApiProperty({
    description: 'Ano de fabricação',
    example: 2024,
  })
  year!: number;

  @ApiProperty({
    description: 'Odômetro atual',
    example: 50000,
  })
  currentMeter!: number;

  @ApiProperty({
    description: 'Marca do veículo',
    example: 'Mercedes-Benz',
  })
  brand!: string;

  @ApiProperty({
    description: 'Intervalo para próxima manutenção',
    example: 10000,
  })
  maintenanceInterval!: number;

  @ApiProperty({
    description: 'Unidade de medida para manutenção',
    enum: ['km', 'hours'],
    example: 'km',
  })
  maintenanceUnit!: 'km' | 'hours';

  @ApiProperty({
    description: 'ID da prefeitura vinculada',
    example: 'pref-001',
  })
  prefeituraId!: string;

  @ApiProperty({
    description: 'Leitura do odômetro na última revisão',
    example: 40000,
  })
  lastRevisionOdometerReading!: number;
}
