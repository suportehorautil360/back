import { ApiProperty } from '@nestjs/swagger';

export class AuthFuncionarioDto {
  @ApiProperty({
    example: 'maria123',
    description: 'CPF (11 dígitos) ou login gerado (nome + 3 dígitos do CPF).',
  })
  identificador!: string;

  @ApiProperty({ example: '12345678900', description: 'Senha (padrão: CPF).' })
  senha!: string;

  @ApiProperty({
    required: false,
    enum: ['motorista', 'comboio', 'checklist'],
    description:
      'App de origem, que define quais equipamentos liberam o login: ' +
      'motorista (FleetFuel — equipamentos que NÃO são comboio), ' +
      'comboio (PWA comboista — só comboios), ' +
      'checklist (app do operador — qualquer equipamento). Padrão: comboio.',
  })
  app?: 'motorista' | 'comboio' | 'checklist';
}
