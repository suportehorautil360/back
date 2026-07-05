import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateAcessoDto {
  @ApiPropertyOptional({ example: 'Maria Oliveira' })
  nome?: string;

  @ApiPropertyOptional({ example: 'maria.oliveira' })
  usuario?: string;

  @ApiPropertyOptional({ enum: ['gestor', 'admin'] })
  perfil?: 'gestor' | 'admin';

  @ApiPropertyOptional({ example: 'maria@cleonirlima.ms.gov.br' })
  email?: string;

  @ApiPropertyOptional({ example: '(67) 99999-0002' })
  whatsapp?: string;

  @ApiPropertyOptional()
  notificaEmail?: boolean;

  @ApiPropertyOptional()
  notificaWhatsapp?: boolean;
}
