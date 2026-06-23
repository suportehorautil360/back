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
