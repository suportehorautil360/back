import { ApiProperty } from '@nestjs/swagger';

/** Conclusão de revisão de um equipamento (libera e adota a leitura informada). */
export class CompleteRevisaoEquipDto {
  @ApiProperty({ description: 'Data da revisão (ISO 8601)', example: '2026-05-31T00:00:00.000Z' })
  revisionDate!: Date;

  @ApiProperty({ description: 'Leitura (km/h) registrada na revisão', example: 52000 })
  odometerReading!: number;

  @ApiProperty({ description: 'Mecânico ou oficina responsável', example: 'Oficina Central' })
  mechanicOrOfficeName!: string;

  @ApiProperty({ description: 'Serviços executados', example: 'Troca de óleo e filtros' })
  servicesDescription!: string;

  @ApiProperty({ description: 'Custo total da revisão', example: 850.0 })
  revisionCost!: number;

  @ApiProperty({ description: 'Número da nota fiscal / comprovante', example: 'NF-0394' })
  invoiceNumber!: string;

  @ApiProperty({ description: 'ID da prefeitura vinculada', example: 'pref-001' })
  prefeituraId!: string;

  @ApiProperty({ description: 'ID do equipamento revisado', example: 'a1b2c3' })
  equipamentoId!: string;
}
