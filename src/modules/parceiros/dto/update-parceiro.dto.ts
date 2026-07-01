import { ApiPropertyOptional } from '@nestjs/swagger';

/** Campos editáveis de um parceiro (posto ou oficina). */
export class UpdateParceiroDto {
  @ApiPropertyOptional({ example: 'Auto Posto Três Lagoas Ltda' })
  razaoSocial?: string;

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

  @ApiPropertyOptional({ example: 'Ipiranga' })
  bandeira?: string;

  @ApiPropertyOptional({ type: [String], example: ['Diesel S10'] })
  combustiveis?: string[];

  @ApiPropertyOptional({ type: [String], example: ['Conveniência'] })
  servicos?: string[];

  @ApiPropertyOptional({ type: [String], example: ['Linha Amarela'] })
  linhasAtuacao?: string[];

  @ApiPropertyOptional({ type: [String], example: ['Máquinas linha amarela'] })
  segmentosAtuacao?: string[];

  @ApiPropertyOptional({ type: [String], example: ['Mecânica Geral'] })
  categoriasServico?: string[];

  @ApiPropertyOptional()
  especificacoes?: string;

  @ApiPropertyOptional({ example: 'Faturamento Quinzenal' })
  condicaoPagamento?: string;

  @ApiPropertyOptional({ example: 50000 })
  limiteCredito?: number;

  @ApiPropertyOptional({ example: '10% peças / 5% mão de obra' })
  descontoComercial?: string;

  @ApiPropertyOptional()
  observacoesFaturamento?: string;
}
