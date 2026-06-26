import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { IdempotencyInterceptor } from '../../common/idempotency.interceptor';
import { CriarIntencaoDto } from './dto/criar-intencao.dto';
import { ValidarAbastecimentoDto } from './dto/validar-abastecimento.dto';
import { VerificarVeiculoDto } from './dto/verificar-veiculo.dto';
import { FleetfuelService } from './fleetfuel.service';

@ApiTags('fleetfuel')
@Controller('fleetfuel')
export class FleetfuelController {
  constructor(private readonly service: FleetfuelService) {}

  @Post('verificacao')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Etapa 1 — verificar veículo + motorista (odômetro, revisão, saldo)',
  })
  async verificar(@Body() dto: VerificarVeiculoDto) {
    return this.service.verificar(dto);
  }

  @Post('intencao')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({
    summary: 'Etapa 2 — confirmar abastecimento e gerar o QR (sem debitar)',
  })
  async criarIntencao(@Body() dto: CriarIntencaoDto) {
    return this.service.criarIntencao(dto);
  }

  @Post('validar')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({
    summary:
      'Etapa 3 — motorista valida o QR (debita o saldo e conclui o abastecimento)',
  })
  async validar(@Body() dto: ValidarAbastecimentoDto) {
    return this.service.validar(dto);
  }

  @Get('intencao/:id')
  @ApiOperation({
    summary: 'Status da intenção (polling do posto-web até concluir)',
  })
  @ApiParam({ name: 'id', description: 'Id da intenção de abastecimento' })
  async status(@Param('id') id: string) {
    return this.service.statusIntencao(id);
  }
}
