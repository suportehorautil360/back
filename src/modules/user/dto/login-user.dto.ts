import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class LoginUserDto {
  @ApiPropertyOptional({
    example: 'postocentro',
    description: 'Login do caixa (legado). Use email ou usuario.',
  })
  @ValidateIf((o: LoginUserDto) => !o.email)
  @IsString()
  @MinLength(1)
  usuario?: string;

  @ApiPropertyOptional({
    example: 'operador@posto.com.br',
    description: 'E-mail cadastrado no acesso do posto.',
  })
  @ValidateIf((o: LoginUserDto) => !o.usuario)
  @IsEmail()
  email?: string;

  @ApiProperty({
    example: '1234',
    description: 'Senha do usuario.',
  })
  @IsString()
  @MinLength(1)
  senha!: string;
}
