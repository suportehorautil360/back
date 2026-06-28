import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CreateAbastecimentoDto } from './dto/create-abastecimento.dto';
import { CreateAbastecimentoMotoristaDto } from './dto/create-abastecimento-motorista.dto';
import { AbastecimentosService } from './abastecimentos.service';
import { IdempotencyInterceptor } from '../../../common/idempotency.interceptor';
import { MotoristaGuard } from '../../../common/motorista.guard';
import { PostoGuard } from '../../../common/posto.guard';

@ApiTags('abastecimentos')
@Controller('abastecimentos')
export class AbastecimentosController {
  constructor(private readonly service: AbastecimentosService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Criar abastecimento' })
  async create(@Body() dto: CreateAbastecimentoDto) {
    const data = await this.service.create(dto);
    return { data, message: 'Abastecimento criado com sucesso!' };
  }

  @Post('motorista')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(MotoristaGuard)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({
    summary: 'Registrar abastecimento manual (motorista, posto avulso)',
    description:
      'Posto não credenciado: fica pendente_aprovacao e não debita crédito até aprovação no 360.',
  })
  async createManualMotorista(@Body() dto: CreateAbastecimentoMotoristaDto) {
    const data = await this.service.createManualMotorista(dto);
    return { data, message: 'Abastecimento registrado — aguardando aprovação.' };
  }

  @Get('ultima-leitura/:prefeituraId')
  @ApiOperation({
    summary: 'Última leitura registrada do equipamento (p/ validar a próxima)',
  })
  @ApiParam({ name: 'prefeituraId' })
  @ApiQuery({ name: 'plateOrChassis', required: true })
  @ApiQuery({
    name: 'measurementType',
    required: true,
    description: 'horimetro | hodometro',
  })
  async ultimaLeitura(
    @Param('prefeituraId') prefeituraId: string,
    @Query('plateOrChassis') plateOrChassis: string,
    @Query('measurementType') measurementType: string,
  ) {
    const data = await this.service.ultimaLeituraPorPlaca(
      prefeituraId,
      plateOrChassis,
      measurementType,
    );
    return { data, message: 'Última leitura buscada com sucesso!' };
  }

  @Get('posto/:postoId')
  @UseGuards(PostoGuard)
  @ApiOperation({
    summary: 'Listar abastecimentos do posto (portal posto-web)',
  })
  @ApiParam({ name: 'postoId', description: 'ID do posto credenciado' })
  @ApiQuery({
    name: 'startDate',
    required: false,
    description: 'Início do período (ISO 8601 ou YYYY-MM-DD)',
    example: '2026-06-01',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    description: 'Fim do período (ISO 8601 ou YYYY-MM-DD)',
    example: '2026-06-30',
  })
  async listarPorPosto(
    @Param('postoId') postoId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.service.listarPorPosto(postoId, startDate, endDate);
  }

  @Get(':prefeituraId')
  @ApiOperation({ summary: 'Listar abastecimentos da prefeitura' })
  @ApiParam({ name: 'prefeituraId' })
  @ApiQuery({
    name: 'startDate',
    required: false,
    description: 'Início do período (ISO 8601 ou YYYY-MM-DD)',
    example: '2026-06-01',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    description: 'Fim do período (ISO 8601 ou YYYY-MM-DD)',
    example: '2026-06-30',
  })
  async listar(
    @Param('prefeituraId') prefeituraId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.service.listar(prefeituraId, startDate, endDate);
  }

  @Delete('item/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remover um abastecimento pelo id' })
  @ApiParam({ name: 'id', description: 'Id do abastecimento' })
  async remover(@Param('id') id: string) {
    return this.service.remover(id);
  }
}
