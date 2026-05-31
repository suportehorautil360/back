import { ApiProperty } from '@nestjs/swagger';

/**
 * Equipamento da prefeitura (coleção `equipamentos`). Mantém os nomes de campo
 * em PT usados pela tela e pelos documentos já existentes — superset do antigo
 * "veículo": inclui chassi, modelo, linha e status "inativo".
 */
export class CreateEquipamentoDto {
  @ApiProperty({ description: 'ID da prefeitura vinculada', example: 'pref-001' })
  prefeituraId!: string;

  @ApiProperty({ description: 'Descrição / nome do equipamento', example: 'Scania R450' })
  descricao!: string;

  @ApiProperty({ description: 'Modelo', required: false, example: 'R450' })
  modelo?: string;

  @ApiProperty({ description: 'Chassi (identificador único de campo)', example: '9BWZZZ377VT004251' })
  chassis!: string;

  @ApiProperty({ description: 'Placa / ID visual', required: false, example: 'ABC-1234' })
  placa?: string;

  @ApiProperty({ description: 'Tipo do equipamento', example: 'Caminhões' })
  tipo!: string;

  @ApiProperty({ description: 'Linha / categoria livre', required: false, example: 'Pesados' })
  linha?: string;

  @ApiProperty({ description: 'Ano de fabricação (texto)', required: false, example: '2022' })
  ano?: string;

  @ApiProperty({ description: 'Marca / fabricante', required: false, example: 'Scania' })
  marca?: string;

  @ApiProperty({ description: 'Leitura atual (km ou horímetro)', example: 50000 })
  medicaoAtual!: number;

  @ApiProperty({ description: 'Intervalo entre revisões', example: 15000 })
  intervaloRevisao!: number;

  @ApiProperty({ description: 'Unidade de medição da revisão', enum: ['km', 'h'], example: 'km' })
  unidadeRevisao!: 'km' | 'h';

  @ApiProperty({ description: 'Leitura na última revisão', example: 40000 })
  ultimaRevisao!: number;

  @ApiProperty({ description: 'Obra / frente de trabalho atual', required: false, example: '' })
  obra?: string;

  @ApiProperty({ description: 'Status', enum: ['ativo', 'bloqueado', 'inativo'], required: false, example: 'ativo' })
  status?: 'ativo' | 'bloqueado' | 'inativo';
}
