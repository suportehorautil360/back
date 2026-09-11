import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/** Payload do PWA operador — espelha `SalvarChecklistInput` do horautil. */
export class SalvarChecklistRunDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  id!: string;

  @ApiProperty({
    description: 'legacyId Firestore ou UUID Postgres da empresa',
  })
  @IsString()
  @IsNotEmpty()
  prefeituraId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  operador!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  dataHoraIso!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  chassis!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  equipamentoId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  modelo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  linha?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoria?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  funcionarioId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  funcionarioCpf?: string;

  @ApiPropertyOptional()
  @IsOptional()
  localizacaoGps?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  horimetro?: string;

  @ApiPropertyOptional()
  @IsOptional()
  fotoHorimetro?: string;

  @ApiPropertyOptional()
  @IsOptional()
  assinaturaOperador?: string;

  @ApiPropertyOptional()
  @IsOptional()
  totalItens?: number;

  @ApiPropertyOptional()
  @IsOptional()
  totalAplicaveis?: number;

  @ApiPropertyOptional()
  @IsOptional()
  totalSim?: number;

  @ApiPropertyOptional()
  @IsOptional()
  totalNao?: number;

  @ApiPropertyOptional()
  @IsOptional()
  totalNa?: number;

  @ApiPropertyOptional()
  @IsOptional()
  itensNao?: unknown[];

  /**
   * As PERGUNTAS que foram feitas: `[{ ordem, texto, severidade }]`, como o
   * operador as viu, na mesma numeração das chaves de `respostas`.
   *
   * Sem isto a auditoria reconstrói o enunciado a partir da definição de hoje,
   * e um item inserido no meio desloca as respostas seguintes.
   */
  @ApiPropertyOptional()
  @IsOptional()
  itens?: unknown[];

  /** Qual documento foi preenchido. Antes se perdia. */
  @ApiPropertyOptional()
  @IsOptional()
  definitionLegacyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  pontuacao?: number;

  @ApiPropertyOptional()
  @IsOptional()
  respostas?: unknown;

  @ApiPropertyOptional()
  @IsOptional()
  obs?: string | null;
}
