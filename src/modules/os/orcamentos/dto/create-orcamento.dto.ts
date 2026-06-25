import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class OrcamentoItemDto {
  @ApiProperty({ example: 'Kit reparo caixa hidráulica' })
  @IsString()
  description!: string;

  @ApiProperty({ example: 4200 })
  @IsNumber()
  @Min(0.01)
  value!: number;

  @ApiPropertyOptional({ enum: ['part', 'service', 'travel'] })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  code?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  brand?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  quantity?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitValue?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  hourType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  hours?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  hourlyRate?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  km?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  valuePerKm?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  travelHours?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  travelHourlyRate?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  fees?: number;
}

export class CreateOrcamentoDto {
  @ApiProperty({ description: 'ID do documento em solicitacoesOS' })
  @IsString()
  solicitacaoOsId!: string;

  @ApiProperty({ description: 'Document ID da oficina em oficinasIds' })
  @IsString()
  oficinaId!: string;

  @ApiProperty({ type: [OrcamentoItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrcamentoItemDto)
  items!: OrcamentoItemDto[];

  @ApiPropertyOptional({ example: 7, description: 'Prazo de entrega em dias' })
  @IsOptional()
  @IsInt()
  @Min(1)
  prazoDias?: number;

  @ApiPropertyOptional({
    description: 'Protocolo exibido (padrão: protocolo da solicitação)',
  })
  @IsOptional()
  @IsString()
  protocol?: string;
}
