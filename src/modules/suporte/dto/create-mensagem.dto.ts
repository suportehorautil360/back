import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { SUPORTE_CHANNELS } from '../suporte.types';

export class CreateMensagemSuporteDto {
  @ApiProperty({ enum: SUPORTE_CHANNELS })
  @IsString()
  @IsIn(SUPORTE_CHANNELS)
  channel!: (typeof SUPORTE_CHANNELS)[number];

  @ApiProperty({ example: 'O sistema deu erro ao enviar nota.' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  text!: string;

  @ApiProperty({ description: 'Deve ser igual ao oficinaId do path' })
  @IsString()
  @MinLength(1)
  oficinaId!: string;
}
