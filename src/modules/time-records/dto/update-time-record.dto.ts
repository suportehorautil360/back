import { ApiProperty } from '@nestjs/swagger';

export class UpdateTimeRecordDto {
  @ApiProperty({
    description: 'Novo horário da batida (ISO 8601).',
    example: '2026-05-25T12:00:00.000Z',
  })
  timestampOriginal!: string;
}
