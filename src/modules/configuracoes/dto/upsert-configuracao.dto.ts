import { ApiProperty } from '@nestjs/swagger';

export class EmpresaDto {
  @ApiProperty({ example: 'Transportes ABC Ltda.' })
  razaoSocial?: string;
  @ApiProperty({ example: '12.345.678/0001-90' })
  cnpj?: string;
  @ApiProperty({ example: 'Três Lagoas' })
  cidade?: string;
  @ApiProperty({ example: 'MS' })
  estado?: string;
  @ApiProperty({ example: 'gestor@empresa.com.br' })
  emailAlertas?: string;
}

export class AlertasDto {
  @ApiProperty() bloqueioRevisaoVencida?: boolean;
  @ApiProperty() nivelCriticoTanque?: boolean;
  @ApiProperty() abastecimentoIrregular?: boolean;
  @ApiProperty() cnhProximaVencimento?: boolean;
  @ApiProperty() relatorioSemanal?: boolean;
}

export class IntervaloTipoDto {
  @ApiProperty({ example: 1000 })
  valor?: number;
  @ApiProperty({ enum: ['km', 'horas'], example: 'km' })
  unidade?: 'km' | 'horas';
}

export class IntervalosDto {
  @ApiProperty({ type: IntervaloTipoDto })
  carro?: IntervaloTipoDto;
  @ApiProperty({ type: IntervaloTipoDto })
  caminhao?: IntervaloTipoDto;
  @ApiProperty({ type: IntervaloTipoDto })
  maquina?: IntervaloTipoDto;
  @ApiProperty({ type: IntervaloTipoDto })
  ambulancia?: IntervaloTipoDto;
  @ApiProperty({ type: IntervaloTipoDto })
  van?: IntervaloTipoDto;
}

export class BloqueioDto {
  @ApiProperty() bloquearAoVencer?: boolean;
  @ApiProperty() alertar80?: boolean;
  @ApiProperty() alertar90?: boolean;
}

export class UpsertConfiguracaoDto {
  @ApiProperty({ example: 'pref-001' })
  prefeituraId!: string;

  @ApiProperty({ type: EmpresaDto })
  empresa?: EmpresaDto;

  @ApiProperty({ type: AlertasDto })
  alertas?: AlertasDto;

  @ApiProperty({ type: IntervalosDto })
  intervalos?: IntervalosDto;

  @ApiProperty({ type: BloqueioDto })
  bloqueio?: BloqueioDto;
}
