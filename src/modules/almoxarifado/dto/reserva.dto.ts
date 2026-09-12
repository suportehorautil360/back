import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

/**
 * `categoriaPlanoId` e `cicloId` NÃO são UUID — são os ids que o import do
 * PDF gera dentro do Json de `PlanoPreventivo.categorias` (ex.: "cat-1",
 * "c1"), lidos por `itensDeTrocaDoCiclo` (regras/plano-pecas.ts). Validar
 * como UUID aqui rejeitaria toda reserva real.
 */
export class ReservarDto {
  @ApiProperty({ description: 'Depósito que atende esta OS.' })
  @IsUUID()
  depositoId!: string;

  @ApiProperty({ description: 'Categoria do plano preventivo (id do Json do plano, não é UUID).' })
  @IsString()
  @IsNotEmpty()
  categoriaPlanoId!: string;

  @ApiProperty({ description: 'Ciclo do plano preventivo (id do Json do plano, não é UUID).' })
  @IsString()
  @IsNotEmpty()
  cicloId!: string;
}
