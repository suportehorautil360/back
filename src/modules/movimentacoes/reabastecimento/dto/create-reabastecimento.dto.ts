import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export const REABASTECIMENTO_SOURCE_TYPES = [
  'gasStation',
  'farmTank',
  'distributor',
] as const;

export type ReabastecimentoSourceType =
  (typeof REABASTECIMENTO_SOURCE_TYPES)[number];

export class CreateReabastecimentoDto {
  @ApiProperty({ description: 'Prefecture identifier (tenant).' })
  @IsString()
  @IsNotEmpty()
  prefeituraId!: string;

  @ApiProperty({
    enum: REABASTECIMENTO_SOURCE_TYPES,
    description: 'Carga source type from the app selector.',
  })
  @IsIn(REABASTECIMENTO_SOURCE_TYPES)
  sourceType!: ReabastecimentoSourceType;

  @ApiProperty({
    description:
      'Id do comboio (equipamento tipo Comboio) cujo tanque recebe a carga.',
  })
  @IsString()
  @IsNotEmpty()
  comboioId!: string;

  @ApiProperty({ description: 'Received liters. Must be greater than zero.' })
  @Type(() => Number)
  @IsNumber()
  @Min(0.000001)
  receivedLiters!: number;

  @ApiPropertyOptional({
    description: 'Id do funcionário (comboista) que registrou a carga.',
  })
  @IsOptional()
  @IsString()
  funcionarioId?: string;

  @ApiPropertyOptional({
    description: 'Fiscal note number. Optional in the app flow.',
    example: 'NF 0455123',
  })
  @IsOptional()
  @IsString()
  invoiceNumber?: string;

  @ApiPropertyOptional({
    description:
      'Client-generated id to support idempotent offline sync retries.',
  })
  @IsOptional()
  @IsString()
  clientRequestId?: string;
}
