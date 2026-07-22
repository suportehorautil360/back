import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsObject, IsString } from 'class-validator';

export class UpsertCargosPermissaoDto {
  @ApiProperty({
    description: 'ID da prefeitura / cliente.',
    example: 'pref-001',
  })
  @IsString()
  @IsNotEmpty()
  prefeituraId!: string;

  @ApiProperty({
    description:
      'Mapa cargo normalizado → labels de grupo da sidebar liberados.',
    example: {
      'operador de manutenção': ['Manutenção'],
      motorista: ['Gestão de Frota'],
    },
  })
  @IsObject()
  porCargo!: Record<string, string[]>;
}
