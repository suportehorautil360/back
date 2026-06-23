import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class AprovarSolicitacaoDto {
  @ApiProperty({ description: 'ID do documento em ordensServico' })
  @IsString()
  @MinLength(1)
  ordemServicoId!: string;
}
