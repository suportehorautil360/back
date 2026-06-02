import { ApiProperty } from '@nestjs/swagger';

export class UpsertEscalaDto {
  @ApiProperty({
    description: 'ID da prefeitura / cliente.',
    example: 'pref-001',
  })
  prefeituraId!: string;

  @ApiProperty({ description: 'Início da jornada (HH:MM).', example: '08:00' })
  inicio!: string;

  @ApiProperty({ description: 'Fim da jornada (HH:MM).', example: '18:00' })
  fim!: string;

  @ApiProperty({
    description: 'Dias da semana trabalhados (0=domingo … 6=sábado).',
    example: [1, 2, 3, 4, 5],
    type: [Number],
  })
  diasSemana!: number[];

  @ApiProperty({ description: 'Duração do almoço em minutos.', example: 75 })
  almocoMinutos!: number;
}
