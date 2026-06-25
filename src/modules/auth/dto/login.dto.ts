import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'joao@oficina.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'senhaSegura123' })
  @IsString()
  @IsNotEmpty()
  password!: string;
}
