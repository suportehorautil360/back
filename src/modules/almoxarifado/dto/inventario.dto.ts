import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';

/** Abrir a contagem de um depósito. */
export class AbrirInventarioDto {
  @ApiProperty({ description: 'Depósito a contar.' })
  @IsUUID()
  depositoId!: string;

  @ApiProperty({ description: 'As peças desta rodada. Cíclico é contar um pedaço por vez.' })
  @IsArray()
  @ArrayMinSize(1)
  // Teto de sanidade: contagem com mais de 500 linhas não é cíclica, é parada
  // anual — e o payload viraria um problema de rede antes de virar de regra.
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  pecaIds!: string[];

  @ApiProperty({ required: false, description: 'O que esta rodada cobre.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  observacao?: string;
}

/** O que o almoxarife achou na prateleira. */
export class RegistrarContagemDto {
  @ApiProperty({ description: 'Quanto tem. Zero é um número.' })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  quantidadeContada!: number;
}

/** Fechar a contagem: as diferenças viram ajuste. */
export class ApurarInventarioDto {
  @ApiProperty({ description: 'O que a contagem apurou. Obrigatório — vai para a auditoria.' })
  @IsString()
  @MaxLength(500)
  motivo!: string;
}

/** Desistir da contagem sem apurar. */
export class CancelarInventarioDto {
  @ApiProperty({ description: 'Por que a contagem foi abandonada. Obrigatório — há CHECK no banco.' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  motivo!: string;
}
