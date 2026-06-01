import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export const DESTINATARIO_TIPOS = ['funcionario', 'rh'] as const;
export type DestinatarioTipo = (typeof DESTINATARIO_TIPOS)[number];

export const NOTIFICACAO_TIPOS = ['info', 'sucesso', 'aviso', 'erro'] as const;
export type NotificacaoTipo = (typeof NOTIFICACAO_TIPOS)[number];

/**
 * Cria uma notificação para um destinatário.
 *
 * `destinatarioTipo`:
 *  - "funcionario": destinatarioId é o CPF (limpo) do funcionário alvo
 *  - "rh": destinatarioId é o prefeituraId (broadcast pra todos do RH)
 */
export class CreateNotificacaoDto {
  @ApiProperty({ enum: DESTINATARIO_TIPOS })
  @IsIn(DESTINATARIO_TIPOS)
  destinatarioTipo!: DestinatarioTipo;

  @ApiProperty({
    description:
      'CPF (quando destinatarioTipo=funcionario) ou prefeituraId (quando rh).',
  })
  @IsString()
  @IsNotEmpty()
  destinatarioId!: string;

  @ApiProperty({ description: 'ID da prefeitura (tenant) para escopo.' })
  @IsString()
  @IsNotEmpty()
  prefeituraId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  titulo!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  mensagem!: string;

  @ApiProperty({ enum: NOTIFICACAO_TIPOS, required: false })
  @IsOptional()
  @IsIn(NOTIFICACAO_TIPOS)
  tipo?: NotificacaoTipo;

  @ApiProperty({
    description:
      'Tipo da entidade referenciada (ex.: "solicitacao-ponto", "time-record").',
    required: false,
  })
  @IsOptional()
  @IsString()
  referenciaTipo?: string;

  @ApiProperty({ description: 'ID da entidade referenciada.', required: false })
  @IsOptional()
  @IsString()
  referenciaId?: string;
}
