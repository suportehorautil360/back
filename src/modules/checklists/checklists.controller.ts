import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { AnswerChecklistQuestionDto } from './dto/answer-checklist-question.dto';
import { CreateChecklistRunDto } from './dto/create-checklist-run.dto';
import { ChecklistsService } from './checklists.service';

@ApiTags('checklists')
@Controller('checklists')
export class ChecklistsController {
  constructor(private readonly service: ChecklistsService) {}

  @Post('runs')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Iniciar uma execução de checklist' })
  async createRun(@Body() dto: CreateChecklistRunDto) {
    return this.service.createRun(dto);
  }

  @Post('runs/:id/answers')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Responder pergunta do checklist e executar regras' })
  @ApiParam({ name: 'id', description: 'ID da execução do checklist' })
  async answer(
    @Param('id') id: string,
    @Body() dto: AnswerChecklistQuestionDto,
  ) {
    return this.service.answer(id, dto);
  }
}
