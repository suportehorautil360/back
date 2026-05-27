import { ApiProperty } from '@nestjs/swagger';

export class UpsertFeatureFlagsDto {
  @ApiProperty({ description: 'ID da prefeitura / cliente.', example: 'pref-001' })
  prefeituraId!: string;

  @ApiProperty({
    description: 'Mapa de funcionalidades habilitadas para a prefeitura.',
    example: { ponto: true },
  })
  flags!: Record<string, boolean>;
}
