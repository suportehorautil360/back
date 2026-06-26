import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { SUPORTE_CHANNELS } from '../suporte.types';

export class ResponderSuporteDto {
  @ApiProperty({ enum: SUPORTE_CHANNELS })
  @IsString()
  @IsIn(SUPORTE_CHANNELS)
  channel!: (typeof SUPORTE_CHANNELS)[number];

  @ApiProperty({
    example: 'Sua nota foi aprovada. Pagamento em até 5 dias úteis.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  text!: string;
}
