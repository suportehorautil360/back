import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateParceiroDto {
  @ApiProperty({ enum: ['posto', 'oficina'], example: 'posto' })
  tipo!: 'posto' | 'oficina';

  // ----- Dados gerais -----
  @ApiProperty({ example: 'Auto Posto Três Lagoas Ltda' })
  razaoSocial!: string;

  @ApiPropertyOptional({ example: 'Posto TL Centro' })
  nomeFantasia?: string;

  @ApiPropertyOptional({ example: '00.000.000/0001-00' })
  cnpj?: string;

  @ApiPropertyOptional({ example: '(67) 0000-0000' })
  telefonePrincipal?: string;

  @ApiPropertyOptional({ example: 'contato@empresa.com' })
  emailComercial?: string;

  @ApiPropertyOptional({ example: 'Três Lagoas/MS' })
  cidadeUf?: string;

  @ApiPropertyOptional({ example: 'Rua, número, bairro' })
  endereco?: string;

  @ApiPropertyOptional({
    description:
      'Credencia o parceiro no município (obrigatório para oficina participar do sorteio de OS).',
    example: 'pref-abc-123',
  })
  prefeituraId?: string;

  // ----- Posto -----
  @ApiPropertyOptional({ example: 'Ipiranga' })
  bandeira?: string;

  @ApiPropertyOptional({ type: [String], example: ['Diesel S10', 'GNV'] })
  combustiveis?: string[];

  @ApiPropertyOptional({ type: [String], example: ['Conveniência'] })
  servicos?: string[];

  // ----- Oficina -----
  @ApiPropertyOptional({
    type: [String],
    deprecated: true,
    description:
      'Legado — derivado automaticamente dos segmentos de equipamento.',
    example: ['Linha Amarela'],
  })
  linhasAtuacao?: string[];

  @ApiPropertyOptional({
    type: [String],
    example: ['Máquinas linha amarela', 'Carro leve'],
    description: 'Segmentos de equipamento atendidos pela oficina.',
  })
  segmentosAtuacao?: string[];

  @ApiPropertyOptional({ type: [String], example: ['Mecânica Geral'] })
  categoriasServico?: string[];

  @ApiPropertyOptional()
  especificacoes?: string;

  // ----- Financeiro / contrato -----
  @ApiPropertyOptional({ example: 'Faturamento Quinzenal' })
  condicaoPagamento?: string;

  @ApiPropertyOptional({ example: 50000 })
  limiteCredito?: number;

  @ApiPropertyOptional({ example: '10% peças / 5% mão de obra' })
  descontoComercial?: string;

  @ApiPropertyOptional()
  observacoesFaturamento?: string;
}
