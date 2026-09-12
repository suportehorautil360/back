import { ApiProperty } from '@nestjs/swagger';

export class ReservarDto {
  @ApiProperty({ description: 'Depósito que atende esta OS.' })
  depositoId!: string;

  @ApiProperty({ description: 'Categoria do plano preventivo.' })
  categoriaPlanoId!: string;

  @ApiProperty({ description: 'Ciclo do plano preventivo.' })
  cicloId!: string;
}
