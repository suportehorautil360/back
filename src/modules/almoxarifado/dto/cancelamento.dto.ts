import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class CancelarRequisicaoDto {
  @ApiProperty({ description: 'Por que a requisição não vai mais acontecer.' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  motivo!: string;
}
