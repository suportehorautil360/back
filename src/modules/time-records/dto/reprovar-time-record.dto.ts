import { ApiProperty } from '@nestjs/swagger';

export class ReprovarTimeRecordDto {
  @ApiProperty({
    description: 'Motivo da reprovação da batida.',
    example: 'Foto não confere com o funcionário.',
  })
  motivo!: string;
}
