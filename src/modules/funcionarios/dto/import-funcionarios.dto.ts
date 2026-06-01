import { ApiProperty } from '@nestjs/swagger';
import { CreateFuncionarioDto } from './create-funcionario.dto';

/** Importação em massa de funcionários a partir de uma planilha. */
export class ImportFuncionariosDto {
  @ApiProperty({ description: 'ID da prefeitura', example: 'pref-001' })
  prefeituraId!: string;

  @ApiProperty({
    type: [CreateFuncionarioDto],
    description: 'Linhas da planilha já mapeadas para o modelo de funcionário.',
  })
  funcionarios!: CreateFuncionarioDto[];
}
