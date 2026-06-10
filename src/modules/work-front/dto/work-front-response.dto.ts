import { ApiProperty } from '@nestjs/swagger';

class WorkFrontEquipmentDto {
  @ApiProperty({
    description: 'Nome do equipamento associado à frente de trabalho',
    example: 'Retroescavadeira',
  })
  name!: string;
}

export class WorkFrontItemDto {
  @ApiProperty({
    description: 'Identificador único da frente de trabalho',
    example: '1f0a2c8d-5f11-4d76-9b14-5f7abf2f0a2b',
  })
  id!: string;

  @ApiProperty({
    description: 'Nome da frente de trabalho',
    example: 'Obra do Parque',
  })
  name!: string;

  @ApiProperty({
    description: 'Identificador da prefeitura responsável',
    example: 'pref-001',
  })
  prefeituraId!: string;

  @ApiProperty({
    description: 'Endereço da frente de trabalho',
    example: 'Av. Central, 1234',
  })
  address!: string;

  @ApiProperty({
    description: 'Responsável pela frente de trabalho',
    example: 'João Silva',
  })
  responsible!: string;

  @ApiProperty({
    description: 'Telefone (WhatsApp) da frente de trabalho, em E.164',
    example: '+5511999999999',
    required: false,
  })
  telefone?: string;

  @ApiProperty({
    description: 'Lista de equipamentos associados à frente de trabalho',
    type: () => WorkFrontEquipmentDto,
    isArray: true,
    required: false,
  })
  equipamentos?: WorkFrontEquipmentDto[];

  @ApiProperty({
    description: 'Status atual da frente de trabalho',
    example: 'active',
  })
  status!: string;

  @ApiProperty({
    description: 'Custo estimado da frente de trabalho (em reais)',
    example: 2120,
    required: false,
  })
  cost?: number;

  @ApiProperty({
    description: 'Data de início da frente de trabalho',
    example: '2026-05-24T12:30:45.123Z',
  })
  startDate!: string;

  @ApiProperty({
    description: 'Data de término da frente de trabalho',
    example: '2026-12-31T23:59:59.000Z',
    required: false,
  })
  endDate?: string;

  @ApiProperty({
    description: 'Data de criação do registro',
    example: '2026-05-24T12:30:45.123Z',
  })
  createdAt!: string;
}

export class WorkFrontCreateResponseDto {
  @ApiProperty({
    description: 'Frente de trabalho criada com sucesso',
    type: () => WorkFrontItemDto,
  })
  data!: WorkFrontItemDto;

  @ApiProperty({
    description: 'Mensagem de sucesso da criação',
    example: 'Front de trabalho criado com sucesso',
  })
  message!: string;
}

export class WorkFrontListResponseDto {
  @ApiProperty({
    description: 'Lista de frentes de trabalho encontradas',
    type: () => WorkFrontItemDto,
    isArray: true,
  })
  data!: WorkFrontItemDto[];

  @ApiProperty({
    description: 'Mensagem de sucesso da consulta',
    example: 'Fronts de trabalho com equipamentos recuperados com sucesso.',
  })
  message!: string;
}

export class WorkFrontRemoveResponseDto {
  @ApiProperty({
    description: 'Mensagem de sucesso da remoção',
    example: 'Front de trabalho removido com sucesso',
  })
  message!: string;
}
