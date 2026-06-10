import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Dados do contrato de prestação de serviços. */
export class CreateContratoDto {
  @ApiProperty({ example: '012/2026' })
  numero!: string;

  @ApiPropertyOptional({ example: 'PE 003/2026' })
  processo?: string;

  @ApiPropertyOptional({ example: 'pregao_eletronico' })
  modalidade?: string;

  @ApiPropertyOptional({ example: '2026-01-10' })
  dataAssinatura?: string;

  @ApiProperty({ example: '2026-01-15' })
  vigenciaInicio!: string;

  @ApiPropertyOptional({ example: '2027-01-15' })
  vigenciaFim?: string;

  @ApiProperty({ example: 'Gestão de frota e manutenção de veículos.' })
  objeto!: string;

  @ApiPropertyOptional() valorMensal?: string;
  @ApiPropertyOptional() valorTotal?: string;
  @ApiPropertyOptional() indiceReajuste?: string;
  @ApiPropertyOptional() periodicidadeFaturamento?: string;
  @ApiPropertyOptional() slaRespostaHoras?: string;
  @ApiPropertyOptional() responsavelContratante?: string;
  @ApiPropertyOptional() cargoContratante?: string;
  @ApiPropertyOptional() emailContratante?: string;
  @ApiPropertyOptional() telefoneContratante?: string;
  @ApiPropertyOptional() observacoes?: string;
  @ApiPropertyOptional({ example: 'ativo' }) status?: string;

  @ApiPropertyOptional({
    example: 0,
    description: 'Quantidade inicial de ativos.',
  })
  qtdInicialAtivos?: number;
}

export class CreateClienteDto {
  @ApiProperty({ example: 'Campo Grande' })
  nome!: string;

  @ApiProperty({ example: 'MS' })
  uf!: string;

  @ApiPropertyOptional({
    enum: ['prefeitura', 'locacao'],
    example: 'prefeitura',
  })
  tipoCliente?: 'prefeitura' | 'locacao';

  // --- Dados da empresa (alimentam a tela de Configurações da prefeitura) ---

  @ApiPropertyOptional({ example: '12.345.678/0001-90' })
  cnpj?: string;

  @ApiPropertyOptional({
    description: 'CAEPF/CEI — alternativa ao CNPJ para órgão sem CNPJ.',
  })
  caepf?: string;

  @ApiPropertyOptional({ example: 'Campo Grande' })
  cidade?: string;

  @ApiPropertyOptional({
    description: 'WhatsApp da empresa (E.164).',
    example: '+5567999999999',
  })
  whatsapp?: string;

  @ApiProperty({ type: CreateContratoDto })
  contrato!: CreateContratoDto;
}
