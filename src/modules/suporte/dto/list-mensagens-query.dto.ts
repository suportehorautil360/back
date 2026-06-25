import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, Min } from 'class-validator';
import { SUPORTE_CHANNELS } from '../suporte.types';

export class ListMensagensSuporteQueryDto {
  @ApiPropertyOptional({ enum: SUPORTE_CHANNELS })
  @IsString()
  @IsIn(SUPORTE_CHANNELS)
  channel!: (typeof SUPORTE_CHANNELS)[number];

  @ApiPropertyOptional({ default: 50, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Cursor ISO — carrega mensagens anteriores a esta data',
  })
  @IsOptional()
  @IsISO8601()
  before?: string;
}
