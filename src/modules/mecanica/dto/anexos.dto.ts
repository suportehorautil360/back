import {
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
} from 'class-validator';

export class PecaDto {
  @IsString()
  @MaxLength(300)
  descricao!: string;

  @IsNumber()
  @Min(0)
  quantidade!: number;

  @IsNumber()
  @Min(0)
  valorUnit!: number;

  @IsOptional() @IsString() @MaxLength(60) codigo?: string;
  @IsOptional() @IsString() @MaxLength(120) marca?: string;
  @IsOptional() @IsString() @MaxLength(20) unidade?: string;
}

export class FotoDto {
  @IsUrl({ require_tld: false })
  url!: string;

  @IsOptional() @IsString() @MaxLength(300) legenda?: string;
}

export class OcorrenciaDto {
  @IsString()
  @MaxLength(1000)
  mensagem!: string;
}
