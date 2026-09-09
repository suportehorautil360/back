import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/** Execução de uma revisão preventiva pelo mecânico da oficina própria. */
export class ExecutarPreventivaDto {
  @ApiProperty({
    description: 'Leitura do horímetro/odômetro no momento da revisão.',
    example: 1240.5,
  })
  @IsNumber()
  @Min(0)
  leitura!: number;

  @ApiPropertyOptional({ description: 'O que foi feito.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  servicos?: string;

  @ApiPropertyOptional({ description: 'Custo da revisão, quando houver.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  custo?: number;
}
