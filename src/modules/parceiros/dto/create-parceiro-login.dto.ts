import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateParceiroLoginDto {
  @ApiProperty({ example: 'João Mecânico' })
  nome!: string;

  @ApiProperty({ example: 'joao.oficina' })
  usuario!: string;

  @ApiProperty({ example: 'senha123', description: 'Mínimo 4 caracteres.' })
  senha!: string;

  @ApiPropertyOptional({ enum: ['gestor', 'admin'], example: 'gestor' })
  perfil?: 'gestor' | 'admin';
}

export class ResetParceiroLoginSenhaDto {
  @ApiProperty({ example: 'novaSenha123' })
  senha!: string;
}
