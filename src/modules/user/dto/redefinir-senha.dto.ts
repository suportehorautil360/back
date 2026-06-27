import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class RedefinirSenhaDto {
  @ApiProperty({ description: 'Token recebido por e-mail.' })
  @IsString()
  @MinLength(1)
  token!: string;

  @ApiProperty({ example: 'novaSenha123', description: 'Nova senha (mín. 4).' })
  @IsString()
  @MinLength(4)
  novaSenha!: string;
}
