import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Delete,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiCreatedResponse,
  ApiInternalServerErrorResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { WorkFrontService } from './work-front.service';
import { CreateWorkFrontDto } from './dto/create-work-front.dto';
import {
  WorkFrontCreateResponseDto,
  WorkFrontListResponseDto,
} from './dto/work-front-response.dto';

@ApiTags('work-front')
@Controller('work-front')
export class WorkFrontController {
  constructor(private readonly workFrontService: WorkFrontService) {}

  @ApiOperation({
    summary: 'Criar uma frente de trabalho',
    description:
      'Cria uma nova frente de trabalho com snapshot de criação e status inicial informado no payload.',
  })
  @ApiBody({ type: CreateWorkFrontDto })
  @ApiCreatedResponse({
    description: 'Frente de trabalho criada com sucesso.',
    type: WorkFrontCreateResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Payload inválido para criação da frente de trabalho.',
  })
  @ApiInternalServerErrorResponse({
    description: 'Falha inesperada ao criar a frente de trabalho.',
  })
  @Post()
  create(@Body() createDto: CreateWorkFrontDto) {
    return this.workFrontService.create(createDto);
  }

  @ApiOperation({
    summary: 'Listar frentes de trabalho por prefeitura',
    description:
      'Retorna as frentes de trabalho da prefeitura com as alocações relacionadas em `equipamentos`.',
  })
  @ApiParam({
    name: 'prefeituraId',
    description: 'ID da prefeitura',
  })
  @ApiOkResponse({
    description: 'Lista de frentes de trabalho encontrada.',
    type: WorkFrontListResponseDto,
  })
  @ApiNotFoundResponse({
    description:
      'Nenhuma frente de trabalho encontrada para a prefeitura informada.',
  })
  @ApiInternalServerErrorResponse({
    description: 'Falha inesperada ao buscar as frentes de trabalho.',
  })
  @Get(':prefeituraId')
  findAll(@Param('prefeituraId') prefeituraId: string) {
    return this.workFrontService.findAll(prefeituraId);
  }

  @ApiOperation({
    summary: 'Remover uma frente de trabalho',
    description:
      'Remove a frente de trabalho e também as alocações vinculadas a ela.',
  })
  @ApiParam({
    name: 'workFrontId',
    description: 'ID da frente de trabalho a ser removida',
  })
  @ApiNoContentResponse({
    description: 'Frente de trabalho removida com sucesso.',
  })
  @ApiInternalServerErrorResponse({
    description: 'Falha inesperada ao remover a frente de trabalho.',
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':workFrontId')
  remove(@Param('workFrontId') workFrontId: string) {
    return this.workFrontService.remove(workFrontId);
  }
}
