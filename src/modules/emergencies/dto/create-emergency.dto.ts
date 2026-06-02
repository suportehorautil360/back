import { ApiProperty } from '@nestjs/swagger';

export type EmergencySource = 'manual' | 'checklist_auto';
export type EmergencyStatus =
  | 'ABERTO'
  | 'EM_ATENDIMENTO'
  | 'RESOLVIDO'
  | 'CANCELADO';
export type EmergencySeverity = 'warning' | 'critical' | 'blocking';

export class CreateEmergencyDto {
  @ApiProperty({ example: 'pref-001' })
  prefeituraId!: string;

  @ApiProperty({ example: 'manual', enum: ['manual', 'checklist_auto'] })
  source?: EmergencySource;

  @ApiProperty({
    example: 'critical',
    enum: ['warning', 'critical', 'blocking'],
  })
  severity?: EmergencySeverity;

  @ApiProperty({ example: 'equip-001' })
  equipamentoId?: string;

  @ApiProperty({ example: 'BR123456789000000' })
  chassis?: string;

  @ApiProperty({ example: 'João da Silva' })
  operadorNome!: string;

  @ApiProperty({ example: 'Vazamento de óleo' })
  tipoFalha!: string;

  @ApiProperty({ example: 'Vazamento visível próximo ao motor.' })
  descricao!: string;

  @ApiProperty({ example: '-20.469710, -54.620121', required: false })
  localizacaoGps?: string | null;

  @ApiProperty({ type: [String], required: false })
  fotos?: string[];

  @ApiProperty({ required: false })
  checklistRunId?: string | null;

  @ApiProperty({ required: false })
  checklistId?: string | null;

  @ApiProperty({ required: false })
  questionId?: string | null;

  @ApiProperty({ required: false })
  questionLabel?: string | null;

  @ApiProperty({ required: false })
  answerValue?: unknown;
}
