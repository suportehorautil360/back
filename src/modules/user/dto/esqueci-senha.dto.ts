import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

export class EsqueciSenhaDto {
  @ApiProperty({
    example: 'operador@posto.com.br',
    description: 'E-mail cadastrado no acesso do posto.',
  })
  @IsEmail()
  email!: string;
}
