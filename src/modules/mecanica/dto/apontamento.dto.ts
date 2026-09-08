import { IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

export class LancarApontamentoDto {
  @IsISO8601()
  inicio!: string;

  @IsISO8601()
  fim!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  observacao?: string;
}

export class EditarApontamentoDto {
  @IsISO8601()
  inicio!: string;

  /** Ausente mantém o apontamento aberto. */
  @IsOptional()
  @IsISO8601()
  fim?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  observacao?: string;
}
