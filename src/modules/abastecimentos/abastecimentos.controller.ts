import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam } from '@nestjs/swagger';
import { AbastecimentosService } from './abastecimentos.service';

@ApiTags('abastecimentos')
@Controller('abastecimentos')
export class AbastecimentosController {
  constructor(private readonly service: AbastecimentosService) {}

  @Get(':prefeituraId')
  @ApiOperation({ summary: 'Listar abastecimentos da prefeitura' })
  @ApiParam({ name: 'prefeituraId' })
  async listar(@Param('prefeituraId') prefeituraId: string) {
    return this.service.listar(prefeituraId);
  }
}
