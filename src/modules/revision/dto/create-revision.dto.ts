import { ApiProperty } from '@nestjs/swagger';

export class CreateRevisionDto {
  @ApiProperty({ example: '2026-05-23T00:06:18.785Z' })
  revisionDate!: Date;

  @ApiProperty({ example: 183.9 })
  odometerReading!: number;

  @ApiProperty({ example: 'Gabriel' })
  mechanicOrOfficeName!: string;

  @ApiProperty({ example: 'Troca de oleo' })
  servicesDescription!: string;

  @ApiProperty({ example: 200.0 })
  revisionCost!: number;

  @ApiProperty({ example: 'NF-0394' })
  invoiceNumber!: string;

  @ApiProperty({ example: '21ea6022-3119-4075-87a3-cfefcd70e02f' })
  prefeituraId!: string;

  @ApiProperty({ example: 'f7645c89-923c-4c2d-9580-b0304aa87559' })
  vehicleId!: string;
}
