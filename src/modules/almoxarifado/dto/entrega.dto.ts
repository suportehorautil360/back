import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/** Espelha o comentário de `RequisicaoMaterial.confirmacaoTipo` no schema. */
export const CONFIRMACOES = ['qr', 'codigo_barras', 'pin', 'assinatura'] as const;

export class EntregarDto {
  @ApiProperty({ description: 'Funcionário que está retirando o kit.' })
  @IsUUID()
  recebedorOperatorId!: string;

  @ApiProperty({ enum: CONFIRMACOES })
  @IsIn([...CONFIRMACOES])
  confirmacaoTipo!: string;

  @ApiProperty({ required: false, description: 'Traço da assinatura, quando for o caso.' })
  @IsOptional()
  @IsString()
  @MaxLength(200_000)
  assinatura?: string;
}
