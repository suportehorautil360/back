import { ApiProperty } from '@nestjs/swagger';

export class AuthFuncionarioDto {
  @ApiProperty({
    example: 'maria123',
    description: 'CPF (11 dígitos) ou login gerado (nome + 3 dígitos do CPF).',
  })
  identificador!: string;

  @ApiProperty({ example: '12345678900', description: 'Senha (padrão: CPF).' })
  senha!: string;
}
