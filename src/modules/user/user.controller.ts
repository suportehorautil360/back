import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AdminSecretGuard } from '../whatsapp/admin-secret.guard';
import { BoasVindasPostoDto } from './dto/boas-vindas-posto.dto';
import { EsqueciSenhaDto } from './dto/esqueci-senha.dto';
import { LoginUserDto } from './dto/login-user.dto';
import { RedefinirSenhaDto } from './dto/redefinir-senha.dto';
import { UserService } from './user.service';

@ApiTags('user')
@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Login de usuario e emissao de token JWT',
    description:
      'Autentica por e-mail ou usuario/senha em partner_portal_users (Postgres).',
  })
  async login(@Body() dto: LoginUserDto) {
    return this.userService.login(dto);
  }

  @Post('auth/esqueci-senha')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Solicitar redefinição de senha por e-mail',
    description:
      'Envia link via Resend se o e-mail estiver cadastrado em acesso de posto.',
  })
  async esqueciSenha(@Body() dto: EsqueciSenhaDto) {
    return this.userService.esqueciSenha(dto);
  }

  @Post('auth/redefinir-senha')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Redefinir senha com token do e-mail',
  })
  async redefinirSenha(@Body() dto: RedefinirSenhaDto) {
    return this.userService.redefinirSenha(dto);
  }

  @Post('auth/boas-vindas-posto')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminSecretGuard)
  @ApiSecurity('x-admin-secret')
  @ApiOperation({
    summary: 'Enviar e-mail de boas-vindas ao operador do posto',
    description:
      'Chamado pelo 360 após criar acesso; requer header x-admin-secret.',
  })
  async boasVindasPosto(@Body() dto: BoasVindasPostoDto) {
    return this.userService.enviarBoasVindasPosto(dto);
  }
}
