import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { OficinasService } from './oficinas.service';

@ApiTags('oficinas')
@Controller('oficinas')
export class OficinasController {
  constructor(private readonly oficinasService: OficinasService) {}

  @Get()
  @ApiOperation({
    summary: 'Listar todas as oficinas',
    description:
      'Retorna todos os documentos da coleção `oficinas` (parceiros globais e credenciamentos municipais).',
  })
  @ApiResponse({ status: 200, description: 'Lista de oficinas.' })
  listar() {
    return this.oficinasService.listar();
  }
}
