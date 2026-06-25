import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  @ApiProperty({ example: 'João Silva' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: 'joao@oficina.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'senhaSegura123', minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiProperty({ example: 'uuid-da-oficina' })
  @IsString()
  @IsNotEmpty()
  oficinaId!: string;

  @ApiProperty({ example: 'uuid-da-prefeitura' })
  @IsString()
  @IsNotEmpty()
  prefeituraId!: string;
}
