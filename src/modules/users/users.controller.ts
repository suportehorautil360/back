import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard, type JwtPayload } from '../../common/jwt-auth.guard';
import { CreateUserDto } from './dto/create-user.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@Controller()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post('users')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Registro de usuário de oficina' })
  registerUser(@Body() dto: CreateUserDto) {
    return this.usersService.registerUser(dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Retorna usuário autenticado e oficina vinculada' })
  me(@Req() req: Request & { jwtPayload: JwtPayload }) {
    return this.usersService.me(req.jwtPayload.sub, req.jwtPayload.credLevel);
  }
}
