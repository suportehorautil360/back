import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class LaudoDto {
  @IsString() @MinLength(3) @MaxLength(4000) causa!: string;
  @IsString() @MinLength(3) @MaxLength(4000) servicoFeito!: string;
  @IsOptional() @IsString() @MaxLength(4000) pendencias?: string;
}
