import { ApiProperty } from '@nestjs/swagger';

export class CreateChecklistRunDto {
  @ApiProperty({ example: 'pref-001' })
  prefeituraId!: string;

  @ApiProperty({ example: 'definition-frota-v1', required: false })
  definitionId?: string;

  @ApiProperty({ example: 1, required: false })
  definitionVersion?: number;

  @ApiProperty({ example: 'equip-001' })
  equipamentoId!: string;

  @ApiProperty({ example: 'BR123456789000000' })
  chassis!: string;

  @ApiProperty({ example: 'João da Silva' })
  operadorNome!: string;

  @ApiProperty({ example: 'Motoniveladora', required: false })
  categoria?: string;

  @ApiProperty({
    example: '-20.469710, -54.620121',
    required: false,
    description: 'Coordenadas capturadas no save do checklist (lat, lng).',
  })
  localizacaoGps?: string | null;
}
