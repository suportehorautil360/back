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

  @ApiPropertyOptional({ description: 'Alias PT de description' })
  @IsOptional()
  @IsString()
  descricao?: string;

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

  @ApiPropertyOptional({ description: 'Alias PT de code' })
  @IsOptional()
  @IsString()
  codigo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  brand?: string;

  @ApiPropertyOptional({ description: 'Alias PT de brand' })
  @IsOptional()
  @IsString()
  marca?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  quantity?: number;

  @ApiPropertyOptional({ description: 'Alias PT de quantity' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  quantidade?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitValue?: number;

  @ApiPropertyOptional({ description: 'Alias PT de unitValue' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  valorUnitario?: number;

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

  @ApiProperty({
    type: [String],
    description: 'URLs das fotos de comprovação do orçamento (obrigatório)',
    example: ['https://storage.example/foto1.jpg'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  fotosComprovacao!: string[];

  @ApiPropertyOptional({
    description: 'Protocolo exibido (padrão: protocolo da solicitação)',
  })
  @IsOptional()
  @IsString()
  protocol?: string;
}
