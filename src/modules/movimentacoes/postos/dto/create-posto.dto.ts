import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsNotEmpty, IsString } from 'class-validator';
import { TIPO_PARCEIRO_OPTIONS } from '../postos.types';
import type { TipoParceiro } from '../postos.types';

export class CreatePostoDto {
  @ApiProperty({ description: 'Identificador da prefeitura (tenant).' })
  @IsString()
  @IsNotEmpty()
  prefeituraId!: string;

  @ApiProperty({
    enum: TIPO_PARCEIRO_OPTIONS,
    description: 'Tipo de parceiro credenciado.',
    example: 'posto',
  })
  @IsIn(TIPO_PARCEIRO_OPTIONS)
  tipoParceiro!: TipoParceiro;

  @ApiProperty({ example: '00.000.000/0001-00' })
  @IsString()
  @IsNotEmpty()
  cnpj!: string;

  @ApiProperty({ example: '(19) 99999-9999' })
  @IsString()
  @IsNotEmpty()
  telefonePrincipal!: string;

  @ApiProperty({ example: 'Posto Exemplo Ltda' })
  @IsString()
  @IsNotEmpty()
  razaoSocial!: string;

  @ApiProperty({ example: 'Posto Exemplo' })
  @IsString()
  @IsNotEmpty()
  nomeFantasia!: string;

  @ApiProperty({ example: 'contato@empresa.com' })
  @IsEmail()
  emailComercial!: string;

  @ApiProperty({ example: 'Campinas/SP' })
  @IsString()
  @IsNotEmpty()
  cidadeUf!: string;

  @ApiProperty({ example: 'Rua Exemplo, 123, Centro' })
  @IsString()
  @IsNotEmpty()
  endereco!: string;
}
