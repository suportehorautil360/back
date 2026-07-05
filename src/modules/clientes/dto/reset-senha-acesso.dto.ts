import { ApiProperty } from '@nestjs/swagger';

export class ResetSenhaAcessoDto {
  @ApiProperty({ example: 'novaSenha123', description: 'Nova senha (mín. 4).' })
  senha!: string;
}
