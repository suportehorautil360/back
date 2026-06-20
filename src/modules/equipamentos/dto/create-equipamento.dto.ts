import { ApiProperty } from '@nestjs/swagger';

/**
 * Equipamento da prefeitura (coleção `equipamentos`). Mantém os nomes de campo
 * em PT usados pela tela e pelos documentos já existentes — superset do antigo
 * "veículo": inclui chassi, modelo, linha e status "inativo".
 */
export class CreateEquipamentoDto {
  @ApiProperty({
    description: 'ID da prefeitura vinculada',
    example: 'pref-001',
  })
  prefeituraId!: string;

  @ApiProperty({
    description: 'Descrição / nome do equipamento',
    example: 'Scania R450',
  })
  descricao!: string;

  @ApiProperty({ description: 'Modelo', required: false, example: 'R450' })
  modelo?: string;

  @ApiProperty({
    description: 'Chassi (identificador único de campo)',
    example: '9BWZZZ377VT004251',
  })
  chassis!: string;

  @ApiProperty({
    description: 'Placa / ID visual',
    required: false,
    example: 'ABC-1234',
  })
  placa?: string;

  @ApiProperty({ description: 'Tipo do equipamento', example: 'Caminhões' })
  tipo!: string;

  @ApiProperty({
    description: 'Linha / categoria livre',
    required: false,
    example: 'Pesados',
  })
  linha?: string;

  @ApiProperty({
    description: 'Ano de fabricação (texto)',
    required: false,
    example: '2022',
  })
  ano?: string;

  @ApiProperty({
    description: 'Marca / fabricante',
    required: false,
    example: 'Scania',
  })
  marca?: string;

  @ApiProperty({
    description: 'Leitura atual (km ou horímetro)',
    example: 50000,
  })
  medicaoAtual!: number;

  @ApiProperty({ description: 'Intervalo entre revisões', example: 15000 })
  intervaloRevisao!: number;

  @ApiProperty({
    description: 'Unidade de medição da revisão',
    enum: ['km', 'h'],
    example: 'km',
  })
  unidadeRevisao!: 'km' | 'h';

  @ApiProperty({ description: 'Leitura na última revisão', example: 40000 })
  ultimaRevisao!: number;

  @ApiProperty({
    description: 'Obra / frente de trabalho atual',
    required: false,
    example: '',
  })
  obra?: string;

  @ApiProperty({
    description: 'Status',
    enum: ['ativo', 'bloqueado', 'inativo'],
    required: false,
    example: 'ativo',
  })
  status?: 'ativo' | 'bloqueado' | 'inativo';

  // --- Dados estendidos (cadastro completo de veículo/equipamento) ---

  @ApiProperty({
    description: 'Combustível',
    required: false,
    example: 'Diesel',
  })
  combustivel?: string;

  @ApiProperty({ description: 'Cor', required: false, example: 'Branco' })
  cor?: string;

  @ApiProperty({
    description: 'Renavam',
    required: false,
    example: '00123456789',
  })
  renavam?: string;

  @ApiProperty({ description: 'Número de série', required: false })
  numeroSerie?: string;

  @ApiProperty({
    description: 'Tipo de frota',
    required: false,
    example: 'Própria',
  })
  tipoFrota?: string;

  @ApiProperty({
    description: 'Início da vigência (veículo locado)',
    required: false,
    example: '2026-01-01',
  })
  vigenciaInicio?: string;

  @ApiProperty({
    description: 'Fim da vigência (veículo locado)',
    required: false,
    example: '2026-12-31',
  })
  vigenciaFim?: string;

  @ApiProperty({
    description: 'Inativar veículo locado após fim da vigência',
    required: false,
  })
  inativarAposVigencia?: boolean;

  @ApiProperty({ description: 'Patrimônio / base', required: false })
  patrimonioBase?: string;

  @ApiProperty({
    description: 'Ano de fabricação',
    required: false,
    example: '2022',
  })
  anoFabricacao?: string;

  @ApiProperty({
    description: 'Ano do modelo',
    required: false,
    example: '2023',
  })
  anoModelo?: string;

  @ApiProperty({
    description: 'Capacidade do tanque (litros)',
    required: false,
    example: 300,
  })
  capacidadeTanque?: number;

  @ApiProperty({ description: 'Motorização', required: false })
  motorizacao?: string;

  @ApiProperty({ description: 'Valor do veículo (R$)', required: false })
  valorVeiculo?: number;

  @ApiProperty({ description: 'Gestor responsável', required: false })
  gestorResponsavel?: string;

  @ApiProperty({ description: 'Base / nº centro de custo', required: false })
  centroCusto?: string;

  @ApiProperty({ description: 'Cidade', required: false })
  cidade?: string;

  @ApiProperty({ description: 'Estado (UF)', required: false, example: 'SP' })
  estado?: string;

  @ApiProperty({ description: 'Região', required: false })
  regiao?: string;

  @ApiProperty({
    description: 'Vencimento do IPVA',
    required: false,
    example: '2026-03-31',
  })
  ipva?: string;

  @ApiProperty({
    description: 'Vencimento do seguro',
    required: false,
    example: '2026-06-30',
  })
  seguro?: string;

  @ApiProperty({
    description: 'Vencimento do licenciamento',
    required: false,
    example: '2026-09-30',
  })
  licenciamento?: string;

  @ApiProperty({ description: 'Condutor responsável', required: false })
  condutorResponsavel?: string;

  @ApiProperty({
    description:
      'Condutores responsáveis (ids de funcionários, cargo Motorista). Usado ' +
      'no comboio: define quem pode operá-lo no PWA do comboista.',
    required: false,
    type: [String],
    example: ['func-001', 'func-002'],
  })
  condutoresResponsaveis?: string[];
}
