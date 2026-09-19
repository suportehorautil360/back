import {
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Corpo do `POST manuais/registrar`. O arquivo já está no bucket privado
 * `manuais` — o Route Handler do painel gravou por conta própria — então
 * aqui não há `multipart/form-data`, só o metadado para registrar a linha.
 */
export class RegistrarManualDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  storagePath!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  mimetype!: string;

  @IsNumber()
  @IsPositive()
  tamanhoBytes!: number;

  @IsString()
  @MaxLength(200)
  titulo!: string;

  @IsOptional() @IsString() @MaxLength(200) categoria?: string;
  @IsOptional() @IsString() equipamentoId?: string;
  @IsOptional() @IsString() @MaxLength(200) modelo?: string;
  @IsOptional() @IsString() @MaxLength(200) tipo?: string;
}
