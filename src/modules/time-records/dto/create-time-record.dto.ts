import { ApiProperty } from '@nestjs/swagger';

export class CreateTimeRecordDto {
  @ApiProperty({
    description: 'Nome do funcionário que está batendo o ponto.',
    example: 'João da Silva',
  })
  name!: string;

  @ApiProperty({
    description: 'Foto (selfie) no momento da batida, como data URL base64.',
    example: 'data:image/jpeg;base64,/9j/4AAQSkZJRg...',
  })
  photo!: string;

  @ApiProperty({
    description: 'ID da prefeitura / cliente vinculado.',
    example: 'pref-001',
  })
  prefeituraId!: string;

  @ApiProperty({
    description: 'Horário da batida no dispositivo (ISO 8601).',
    example: '2026-05-25T13:05:00.000Z',
  })
  timestampOriginal!: string;
}
