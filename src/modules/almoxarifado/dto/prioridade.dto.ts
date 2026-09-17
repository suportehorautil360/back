import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { PRIORIDADES } from '../regras/compras';

/** A mudança de prioridade na fila de compra (critério 10). */
export class AlterarPrioridadeDto {
  @ApiProperty({ description: 'Item da solicitação de compra.' })
  @IsUUID()
  solicitacaoItemId!: string;

  @ApiProperty({ description: 'A nova prioridade.', enum: PRIORIDADES })
  @IsIn(PRIORIDADES as unknown as string[])
  prioridade!: string;

  @ApiProperty({ description: 'Por que ela muda. Obrigatório — vai para a auditoria.' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  motivo!: string;
}
