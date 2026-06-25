import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';
import { SUPORTE_CHANNELS } from '../suporte.types';

export class MarcarMensagensLidasDto {
  @ApiProperty({ enum: SUPORTE_CHANNELS })
  @IsString()
  @IsIn(SUPORTE_CHANNELS)
  channel!: (typeof SUPORTE_CHANNELS)[number];
}
