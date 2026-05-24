import { ApiProperty } from '@nestjs/swagger';

export class CreateRevisionDto {
  @ApiProperty({
    description: 'Data da revisão no formato ISO 8601',
    example: '2026-05-23T00:06:18.785Z',
  })
  revisionDate!: Date;

  @ApiProperty({
    description: 'Quilometragem registrada no momento da revisão',
    example: 183.9,
  })
  odometerReading!: number;

  @ApiProperty({
    description: 'Nome do mecânico ou oficina responsável pela revisão',
    example: 'Gabriel',
  })
  mechanicOrOfficeName!: string;

  @ApiProperty({
    description: 'Descrição dos serviços executados na revisão',
    example: 'Troca de oleo',
  })
  servicesDescription!: string;

  @ApiProperty({
    description: 'Custo total da revisão',
    example: 200.0,
  })
  revisionCost!: number;

  @ApiProperty({
    description: 'Número da nota fiscal ou comprovante da revisão',
    example: 'NF-0394',
  })
  invoiceNumber!: string;

  @ApiProperty({
    description: 'Identificador da prefeitura vinculada',
    example: '21ea6022-3119-4075-87a3-cfefcd70e02f',
  })
  prefeituraId!: string;

  @ApiProperty({
    description: 'Identificador do veículo que passará pela revisão',
    example: 'f7645c89-923c-4c2d-9580-b0304aa87559',
  })
  vehicleId!: string;
}
