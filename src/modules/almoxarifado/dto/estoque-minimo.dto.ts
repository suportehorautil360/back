import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/** Pedido de verificação da reposição automática de uma peça (§5 da F4). */
export class VerificarEstoqueMinimoDto {
  @ApiProperty({ description: 'Peça cujo mínimo mudou.' })
  @IsUUID()
  pecaId!: string;
}
