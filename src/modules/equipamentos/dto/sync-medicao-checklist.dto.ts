import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class SyncMedicaoChecklistDto {
  @ApiProperty({
    description: 'Leitura informada no checklist (ex.: "6890,2" ou "45.000 km")',
    example: '6890,2',
  })
  @IsString()
  @MinLength(1)
  leituraTexto!: string;
}
