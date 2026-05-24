import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsDateString,
  IsOptional,
} from 'class-validator';

export class CreateWorkFrontDto {
  @ApiProperty({
    description: 'Nome da frente de trabalho',
    example: 'Obra do Parque',
  })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({
    description: 'Identificador da prefeitura responsável',
    example: 'pref-001',
  })
  @IsString()
  @IsNotEmpty()
  prefeituraId!: string;

  @ApiProperty({
    description: 'Endereço da frente de trabalho',
    example: 'Av. Central, 1234',
  })
  @IsString()
  @IsNotEmpty()
  address!: string;

  @ApiProperty({
    description: 'Responsável pela frente de trabalho',
    example: 'João Silva',
  })
  @IsString()
  @IsNotEmpty()
  responsible!: string;

  @ApiProperty({
    description: 'Lista de equipamentos associados à frente de trabalho',
    example: ['Retroescavadeira', 'Caminhão basculante'],
    type: [String],
    required: false,
  })
  equipaments: string[] = [];

  @ApiProperty({
    description: 'Status atual da frente de trabalho',
    example: 'active',
  })
  @IsString()
  status!: string;

  @ApiProperty({
    description: 'Data de início da frente de trabalho no formato ISO 8601',
    example: '2026-05-24T12:30:45.123Z',
  })
  @IsDateString()
  startDate!: string;

  @ApiProperty({
    description: 'Data de término da frente de trabalho no formato ISO 8601',
    example: '2026-12-31T23:59:59.000Z',
    required: false,
  })
  @IsDateString()
  @IsOptional()
  endDate?: string;
}
