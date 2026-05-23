import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { RevisionService } from './revision.service';
import { CreateRevisionDto } from './dto/create-revision.dto';

@ApiTags('revision')
@Controller('revision')
export class RevisionController {
  constructor(private readonly revisionService: RevisionService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Registrar uma nova revisão' })
  @ApiResponse({ status: 201, description: 'Revisão registrada com sucesso.' })
  @ApiResponse({
    status: 400,
    description: 'Bad Request: A quilometragem é insuficiente ou inválida.',
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
  async create(@Body() createRevisionDto: CreateRevisionDto) {
    return this.revisionService.create(createRevisionDto);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Listar revisões por ID' })
  @ApiParam({
    name: 'id',
    description: 'ID da prefeitura',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de revisões encontrada.',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: { $ref: '#/components/schemas/CreateRevisionDto' },
        },
        message: {
          type: 'string',
          example: 'Revisões encontradas com sucesso!',
        },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Nenhuma revisão encontrada.',
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
  async findAllById(@Param('id') id: string) {
    return this.revisionService.findAllById(id);
  }
}
