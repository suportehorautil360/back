import { ApiProperty } from '@nestjs/swagger';
import type { EmergencyStatus } from './create-emergency.dto';

export class UpdateEmergencyStatusDto {
  @ApiProperty({
    enum: ['ABERTO', 'EM_ATENDIMENTO', 'RESOLVIDO', 'CANCELADO'],
    example: 'RESOLVIDO',
  })
  status!: EmergencyStatus | 'Aberto' | 'Resolvido' | 'aberto' | 'resolvido';
}
