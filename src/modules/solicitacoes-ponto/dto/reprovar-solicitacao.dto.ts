import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ReprovarSolicitacaoDto {
  @ApiProperty({ description: 'Motivo da reprovação.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(250)
  motivo!: string;
}
