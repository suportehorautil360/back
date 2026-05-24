import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CreateAllocationDto } from './dto/create-allocation.dto';
import { AllocationResponseDto } from './dto/allocation-response.dto';
import { AllocationsService } from './allocations.service';

@ApiTags('allocations')
@Controller('allocation')
export class AllocationsController {
  constructor(private readonly allocationsService: AllocationsService) {}

  @ApiOperation({
    summary: 'Registrar uma nova alocação de veículo',
    description:
      'Persiste a alocação no Firestore com snapshot da frente atual, data de criação e status inicial ativo.',
  })
  @ApiBody({ type: CreateAllocationDto })
  @ApiCreatedResponse({
    description: 'Alocação criada com sucesso.',
    type: AllocationResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Payload inválido para criação da alocação.',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Validation failed' },
        error: { type: 'string', example: 'Bad Request' },
        statusCode: { type: 'number', example: 400 },
      },
    },
  })
  @Post()
  create(@Body() createDto: CreateAllocationDto) {
    return this.allocationsService.allocate(createDto);
  }
}
