import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateTimeRecordDto {
  @ApiProperty({
    description: 'Novo horário da batida (ISO 8601).',
    example: '2026-05-25T12:00:00.000Z',
  })
  timestampOriginal!: string;

  @ApiProperty({
    description:
      'Motivo da correção (opcional). A correção entra como um registro de AJUSTE separado (a batida original não é alterada) e fica pendente de aprovação do RH.',
    example: 'Esqueci de bater na hora certa, registrei depois.',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(250)
  motivo?: string;
}
