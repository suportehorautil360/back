import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class SendTestEmailDto {
  @ApiProperty({
    description: 'Email do destinatário do teste.',
    example: 'voce@exemplo.com',
  })
  @IsEmail()
  to!: string;

  @ApiPropertyOptional({ description: 'Assunto (opcional).' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string;

  @ApiPropertyOptional({ description: 'Mensagem livre (opcional).' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  mensagem?: string;
}
