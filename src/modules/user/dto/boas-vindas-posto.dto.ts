import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class BoasVindasPostoDto {
  @ApiProperty({ example: 'operador@posto.com.br' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Maria Silva' })
  @IsString()
  @MinLength(1)
  nome!: string;

  @ApiProperty({ example: 'postocentro' })
  @IsString()
  @MinLength(1)
  usuario!: string;

  @ApiPropertyOptional({ example: 'Posto Central' })
  @IsOptional()
  @IsString()
  postoNome?: string;

  @ApiPropertyOptional({
    description: 'Senha em texto (só no e-mail de boas-vindas).',
  })
  @IsOptional()
  @IsString()
  @MinLength(4)
  senhaTemporaria?: string;
}
