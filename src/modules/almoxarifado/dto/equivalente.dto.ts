import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsString, IsUUID, MaxLength } from 'class-validator';

/** A proposta do almoxarife: trocar a peça que falta por uma equivalente. */
export class ProporEquivalenteDto {
  @ApiProperty({ description: 'Item faltante da requisição.' })
  @IsUUID()
  itemId!: string;

  @ApiProperty({
    description:
      'Peça a propor. Tem de estar cadastrada como equivalente da original.',
  })
  @IsUUID()
  pecaEquivalenteId!: string;

  @ApiProperty({
    description:
      'Por que a troca — fica na auditoria e é o que a mecânica lê para decidir.',
  })
  @IsString()
  @MaxLength(500)
  motivo!: string;
}

/** A decisão técnica da mecânica sobre a proposta (critério 11). */
export class DecidirEquivalenteDto {
  @ApiProperty({ description: 'Item que está esperando aprovação.' })
  @IsUUID()
  itemId!: string;

  @ApiProperty({ description: 'Se a peça de outra marca serve nesta máquina.' })
  @IsBoolean()
  aprovar!: boolean;

  @ApiProperty({
    description: 'Por que serve, ou por que não serve. Fica na auditoria.',
  })
  @IsString()
  @MaxLength(500)
  motivo!: string;
}
