import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export const TIPOS_SOLICITACAO = [
  'incluir',
  'cancelar',
  'abono',
  'mensagem',
] as const;
export type TipoSolicitacao = (typeof TIPOS_SOLICITACAO)[number];

export const TIPOS_BATIDA = ['entrada', 'almoco', 'volta', 'saida'] as const;
export type TipoBatida = (typeof TIPOS_BATIDA)[number];

/**
 * Solicitação de ajuste de ponto. Um único recurso atende quatro fluxos
 * que o operador dispara da folha do dia (Incluir batida, Cancelar batida,
 * Solicitar abono, Enviar mensagem). O `tipo` discrimina o caso.
 */
export class CreateSolicitacaoPontoDto {
  @ApiProperty({ enum: TIPOS_SOLICITACAO })
  @IsIn(TIPOS_SOLICITACAO)
  tipo!: TipoSolicitacao;

  @ApiProperty({ description: 'ID da prefeitura (tenant).' })
  @IsString()
  @IsNotEmpty()
  prefeituraId!: string;

  @ApiProperty({ description: 'Nome do funcionário (denormalizado).' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({
    description: 'CPF do funcionário (só dígitos).',
    required: false,
  })
  @IsOptional()
  @IsString()
  cpf?: string;

  @ApiProperty({
    description:
      'Para tipo "cancelar": id da batida (timeRecord) que se quer cancelar.',
    required: false,
  })
  @IsOptional()
  @IsString()
  batidaId?: string;

  @ApiProperty({
    description:
      'Para tipo "incluir" / "abono": data alvo no formato YYYY-MM-DD.',
    required: false,
    example: '2026-05-28',
  })
  @IsOptional()
  @IsString()
  data?: string;

  @ApiProperty({
    description: 'Para tipo "incluir": horário alvo (ISO 8601).',
    required: false,
  })
  @IsOptional()
  @IsString()
  timestampOriginal?: string;

  @ApiProperty({
    description:
      'Para tipo "incluir": qual batida do dia (entrada/almoco/volta/saida). ' +
      'Default "entrada" quando ausente.',
    enum: TIPOS_BATIDA,
    required: false,
  })
  @IsOptional()
  @IsIn(TIPOS_BATIDA)
  tipoBatida?: TipoBatida;

  @ApiProperty({
    description: 'Observação / mensagem livre do operador.',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  observacao?: string;

  @ApiProperty({
    description:
      'Anexo opcional como data URL (base64). Em produção, melhor subir pro Storage e mandar a URL.',
    required: false,
  })
  @IsOptional()
  @IsString()
  anexoDataUrl?: string;

  @ApiProperty({
    description: 'Nome do arquivo do anexo (para exibição).',
    required: false,
  })
  @IsOptional()
  @IsString()
  anexoNome?: string;
}
