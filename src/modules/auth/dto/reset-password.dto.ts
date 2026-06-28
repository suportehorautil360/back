import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';
import { MIN_NEW_PASSWORD_LENGTH } from '../helpers/user-password.helper';

export class ResetPasswordDto {
  @ApiProperty({ description: 'Token recebido por e-mail.' })
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiProperty({
    example: 'novaSenhaSegura123',
    minLength: MIN_NEW_PASSWORD_LENGTH,
  })
  @IsString()
  @MinLength(MIN_NEW_PASSWORD_LENGTH)
  newPassword!: string;
}
