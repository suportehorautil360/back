import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { SUPORTE_CHANNELS } from '../suporte.types';

export class CreateMensagemSuportePostoDto {
  @ApiProperty({ enum: SUPORTE_CHANNELS })
  @IsString()
  @IsIn(SUPORTE_CHANNELS)
  channel!: (typeof SUPORTE_CHANNELS)[number];

  @ApiProperty({ example: 'Tenho dúvida sobre o reembolso da nota de junho.' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  text!: string;

  @ApiProperty({ description: 'Deve ser igual ao postoId do path' })
  @IsString()
  @MinLength(1)
  postoId!: string;

  @ApiPropertyOptional({ description: 'Prefeitura dona do posto (inbox 360)' })
  @IsOptional()
  @IsString()
  prefeituraId?: string;
}
