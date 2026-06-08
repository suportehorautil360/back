import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAcessoDto {
  @ApiProperty({ example: 'Maria Oliveira' })
  nome!: string;

  @ApiProperty({ example: 'maria.oliveira' })
  usuario!: string;

  @ApiProperty({ example: 'senha123', description: 'Senha inicial (mín. 4).' })
  senha!: string;

  @ApiPropertyOptional({ enum: ['gestor', 'admin'], example: 'gestor' })
  perfil?: 'gestor' | 'admin';

  @ApiPropertyOptional({ example: 'maria@cleonirlima.ms.gov.br' })
  email?: string;

  @ApiPropertyOptional({ example: '(67) 99999-0002' })
  whatsapp?: string;

  @ApiPropertyOptional({ default: true })
  notificaEmail?: boolean;

  @ApiPropertyOptional({ default: true })
  notificaWhatsapp?: boolean;
}
