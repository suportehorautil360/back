import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  ValidateIf,
} from 'class-validator';

export class LoginDto {
  @ApiPropertyOptional({ example: 'joao@oficina.com' })
  @ValidateIf((dto: LoginDto) => !dto.usuario)
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: 'oficina.mecanica.sul.abc123' })
  @ValidateIf((dto: LoginDto) => !dto.email)
  @IsString()
  @IsNotEmpty()
  usuario?: string;

  @ApiProperty({ example: 'senhaSegura123' })
  @IsString()
  @IsNotEmpty()
  password!: string;
}
