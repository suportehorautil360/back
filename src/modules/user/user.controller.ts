import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { LoginUserDto } from './dto/login-user.dto';
import { UserService } from './user.service';

@ApiTags('user')
@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Login de usuario e emissao de token JWT',
    description: 'Autentica por usuario/senha no Firestore.',
  })
  async login(@Body() dto: LoginUserDto) {
    return this.userService.login(dto);
  }
}
