import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class LoginUserDto {
  @ApiProperty({
    example: 'jeffersonadmin',
    description: 'Usuario de login.',
  })
  @IsString()
  @MinLength(1)
  usuario!: string;

  @ApiProperty({
    example: '1234',
    description: 'Senha do usuario.',
  })
  @IsString()
  @MinLength(1)
  senha!: string;
}
