import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsPositive, IsString, IsUUID, Max, MaxLength } from 'class-validator';

/** O pedido de peça do mecânico com a OS em andamento (§5 da F4). */
export class PedirPecaAdicionalDto {
  @ApiProperty({ description: 'Peça do catálogo.' })
  @IsUUID()
  pecaId!: string;

  // `quantidade_solicitada` é `NUMERIC(12,3)`: três casas e o teto da coluna
  // aqui, para o erro voltar 400 e não 500 do Postgres.
  @ApiProperty({ description: 'Quanto. Maior que zero, até 3 casas.' })
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  @Max(999_999_999.999)
  quantidade!: number;

  @ApiProperty({ description: 'Sem ela a máquina não anda — decide a prioridade da compra.' })
  @IsBoolean()
  impeditivo!: boolean;

  @ApiProperty({ description: 'Por que a peça é necessária. Obrigatório (CHECK no banco).' })
  @IsString()
  @MaxLength(500)
  motivo!: string;
}
