import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam } from '@nestjs/swagger';
import { FuncionariosService } from './funcionarios.service';
import { CreateFuncionarioDto } from './dto/create-funcionario.dto';
import { ImportFuncionariosDto } from './dto/import-funcionarios.dto';
import { AuthFuncionarioDto } from './dto/auth-funcionario.dto';

@ApiTags('funcionarios')
@Controller('funcionarios')
export class FuncionariosController {
  constructor(private readonly service: FuncionariosService) {}

  // --- Rotas com prefixo estático primeiro (evita colisão com :param) ---

  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login do operador/funcionário (app de campo)' })
  async autenticar(@Body() dto: AuthFuncionarioDto) {
    return this.service.autenticar(dto);
  }

  @Post('import')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Importar vários funcionários (planilha)' })
  async importar(@Body() dto: ImportFuncionariosDto) {
    return this.service.importar(dto.prefeituraId, dto.funcionarios ?? []);
  }

  @Post('update/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Atualizar funcionário' })
  @ApiParam({ name: 'id' })
  async update(@Param('id') id: string, @Body() dto: CreateFuncionarioDto) {
    return this.service.update(id, dto);
  }

  @Post('status/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ativar/inativar funcionário' })
  @ApiParam({ name: 'id' })
  async status(
    @Param('id') id: string,
    @Body() body: { status: 'ativo' | 'inativo' },
  ) {
    return this.service.definirStatus(id, body?.status);
  }

  @Post('reset-senha/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resetar a senha do funcionário para o CPF' })
  @ApiParam({ name: 'id' })
  async resetSenha(@Param('id') id: string) {
    return this.service.resetarSenha(id);
  }

  @Get('item/:id')
  @ApiOperation({ summary: 'Buscar funcionário pelo id' })
  @ApiParam({ name: 'id' })
  async findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Get('cpf-em-uso/:prefeituraId/:cpf')
  @ApiOperation({ summary: 'Checa se o CPF já está em uso na prefeitura' })
  async cpfEmUso(
    @Param('prefeituraId') prefeituraId: string,
    @Param('cpf') cpf: string,
    @Query('ignorarId') ignorarId?: string,
  ) {
    return this.service.cpfEmUso(prefeituraId, cpf, ignorarId);
  }

  @Get('credenciais-offline/:prefeituraId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Verificadores p/ login OFFLINE do app de campo (condutores da prefeitura)',
  })
  @ApiParam({ name: 'prefeituraId' })
  async credenciaisOffline(@Param('prefeituraId') prefeituraId: string) {
    const data = await this.service.credenciaisOffline(prefeituraId);
    return { data, message: 'Credenciais offline.' };
  }

  // --- Rotas com :param ---

  @Post(':prefeituraId')
  @ApiOperation({ summary: 'Criar funcionário' })
  @ApiParam({ name: 'prefeituraId' })
  async create(
    @Param('prefeituraId') prefeituraId: string,
    @Body() dto: CreateFuncionarioDto,
  ) {
    return this.service.create(prefeituraId, dto);
  }

  @Get(':prefeituraId')
  @ApiOperation({ summary: 'Listar funcionários da prefeitura' })
  @ApiParam({ name: 'prefeituraId' })
  async findAll(@Param('prefeituraId') prefeituraId: string) {
    return this.service.findAllByPrefeitura(prefeituraId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remover funcionário' })
  @ApiParam({ name: 'id' })
  async remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
