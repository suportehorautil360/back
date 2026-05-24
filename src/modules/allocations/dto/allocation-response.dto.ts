import { ApiProperty } from '@nestjs/swagger';

class AllocationCurrentWorkFrontDto {
  @ApiProperty({
    description:
      'Identificador da frente de trabalho atual vinculada à alocação',
    example: 'wf-001',
  })
  id!: string;

  @ApiProperty({
    description: 'Nome da frente de trabalho atual',
    example: 'Obra do Parque',
  })
  name!: string;
}

export class AllocationResponseDto {
  @ApiProperty({
    description: 'Identificador único da alocação',
    example: 'b5d2f0cf-7d27-4de1-8a5d-6cba6fd1f7d4',
  })
  id!: string;

  @ApiProperty({
    description: 'Identificador do veículo alocado',
    example: 'veh-001',
  })
  vehicleId!: string;

  @ApiProperty({
    description: 'Identificador da frente de trabalho de destino',
    example: 'wf-001',
  })
  workFrontId!: string;

  @ApiProperty({
    description: 'Placa do veículo para conferência humana',
    example: 'ABC-1234',
  })
  plate!: string;

  @ApiProperty({
    description: 'Nome da frente de trabalho de destino',
    example: 'Obra do Parque',
  })
  workFrontName!: string;

  @ApiProperty({
    description: 'Data de início da alocação no formato DD/MM/YYYY',
    example: '10/01/2026',
  })
  startDate!: string;

  @ApiProperty({
    description: 'Função operacional da alocação',
    example: 'Transporte',
  })
  function!: string;

  @ApiProperty({
    description: 'Identificador da prefeitura responsável pela alocação',
    example: 'pref-001',
  })
  prefeituraId!: string;

  @ApiProperty({
    description: 'Snapshot da frente de trabalho atual no momento da alocação',
    type: () => AllocationCurrentWorkFrontDto,
  })
  currentWorkFront!: AllocationCurrentWorkFrontDto;

  @ApiProperty({
    description: 'Data em que a alocação foi registrada',
    example: '2026-05-24T12:30:45.123Z',
  })
  createdAt!: string;

  @ApiProperty({
    description: 'Estado atual da alocação',
    example: 'active',
  })
  status!: string;
}
