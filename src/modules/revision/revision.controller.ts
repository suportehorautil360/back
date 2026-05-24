import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiBody,
} from '@nestjs/swagger';
import { RevisionService } from './revision.service';
import { CreateRevisionDto } from './dto/create-revision.dto';
import {
  RevisionCreateResponseDto,
  RevisionListResponseDto,
} from './dto/revision-response.dto';

@ApiTags('revision')
@Controller('revision')
export class RevisionController {
  constructor(private readonly revisionService: RevisionService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Registrar uma nova revisão',
    description:
      'Valida a quilometragem do veículo, grava a revisão e bloqueia o veículo até a conclusão do processo.',
  })
  @ApiBody({ type: CreateRevisionDto })
  @ApiCreatedResponse({
    description: 'Revisão registrada com sucesso.',
    type: RevisionCreateResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Dados inválidos para criação da revisão.',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          example:
            'A quilometragem deve ser pelo menos 1.000 km maior que a última revisão (0 km).',
        },
        error: { type: 'string', example: 'Bad Request' },
        statusCode: { type: 'number', example: 400 },
      },
    },
  })
  @ApiInternalServerErrorResponse({
    description: 'Falha inesperada ao persistir a revisão.',
  })
  async create(@Body() createRevisionDto: CreateRevisionDto) {
    return this.revisionService.create(createRevisionDto);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Listar revisões por prefeitura',
    description:
      'Retorna todas as revisões associadas ao ID da prefeitura informada.',
  })
  @ApiParam({
    name: 'id',
    description: 'ID da prefeitura',
  })
  @ApiOkResponse({
    description: 'Lista de revisões encontrada.',
    type: RevisionListResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Nenhuma revisão encontrada para a prefeitura informada.',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          example: 'Nenhuma revisão encontrada para a prefeitura fornecida.',
        },
        error: { type: 'string', example: 'Not Found' },
        statusCode: { type: 'number', example: 404 },
      },
    },
  })
  @ApiInternalServerErrorResponse({
    description: 'Falha inesperada ao consultar as revisões.',
  })
  async findAllById(@Param('id') id: string) {
    return this.revisionService.findAllById(id);
  }
}
