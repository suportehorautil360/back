import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SalvarEmergenciaDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  prefeituraId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty({ enum: ['manual', 'checklist_auto'] })
  @IsIn(['manual', 'checklist_auto'])
  source!: 'manual' | 'checklist_auto';

  @ApiPropertyOptional({ enum: ['warning', 'critical', 'blocking'] })
  @IsOptional()
  @IsIn(['warning', 'critical', 'blocking'])
  severity?: 'warning' | 'critical' | 'blocking';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  chassis?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  equipamentoLegacyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  idMaquina?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  modelo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  operadorNome?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  operadorLegacyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  operadorCpf?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  tipoFalha!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  descricao!: string;

  @ApiPropertyOptional()
  @IsOptional()
  localizacaoGps?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  fotos?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  checklistLegacyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  questionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  questionLabel?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  dataHoraIso!: string;
}
