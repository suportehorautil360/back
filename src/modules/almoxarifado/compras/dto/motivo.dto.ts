import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Corpo dos atos que tiram algo do radar — rejeitar ou cancelar solicitação,
 * devolver, cancelar ou encerrar ordem de compra. Todos gravam o motivo, e os
 * CHECKs do banco recusam `rejeitada`/`cancelada`/`encerrada` sem ele.
 */
export class MotivoDto {
  @ApiProperty({ description: 'Por que o ato está sendo feito. Fica no documento e no rastro.' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  motivo!: string;
}
