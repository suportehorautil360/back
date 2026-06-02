import { ApiProperty } from '@nestjs/swagger';

/**
 * Funcionário/operador (coleção `operadores`). Apenas `nome` e `cpf` são
 * obrigatórios; o resto tem padrão (cargo vazio, tipo operador, status ativo).
 * A senha inicial, quando ausente, vira o CPF.
 */
export class CreateFuncionarioDto {
  @ApiProperty({ description: 'Nome completo', example: 'João da Silva' })
  nome!: string;

  @ApiProperty({
    description: 'CPF (com ou sem máscara)',
    example: '123.456.789-09',
  })
  cpf!: string;

  @ApiProperty({ required: false, example: 'Operador' })
  cargo?: string;

  @ApiProperty({ required: false, example: '(67) 99999-0000' })
  telefone?: string;

  @ApiProperty({
    required: false,
    enum: ['operador', 'supervisor', 'admin'],
    example: 'operador',
  })
  tipo?: 'operador' | 'supervisor' | 'admin';

  @ApiProperty({
    required: false,
    enum: ['ativo', 'inativo'],
    example: 'ativo',
  })
  status?: 'ativo' | 'inativo';

  @ApiProperty({
    required: false,
    description: 'Senha em texto puro; ausente => CPF vira a senha inicial.',
  })
  senha?: string;

  @ApiProperty({ required: false })
  matricula?: string;

  @ApiProperty({ required: false, example: '1990-05-20' })
  dataNascimento?: string;

  @ApiProperty({ required: false })
  rg?: string;

  @ApiProperty({ required: false })
  cnh?: string;

  @ApiProperty({ required: false, example: 'AB' })
  cnhCategoria?: string;

  @ApiProperty({ required: false, example: '2030-01-01' })
  cnhValidade?: string;

  @ApiProperty({ required: false, example: 'SP' })
  cnhLocalEmissao?: string;

  @ApiProperty({ required: false })
  cnhEmissao?: string;

  @ApiProperty({ required: false })
  cnhRestricao?: string;

  @ApiProperty({ required: false })
  observacoes?: string;
}
