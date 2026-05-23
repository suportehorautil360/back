import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  HttpStatus,
  HttpCode,
  Delete,
} from '@nestjs/common';
import { RevisionService } from './revision.service';
import { CreateRevisionDto } from './dto/create-revision.dto';

@Controller('revision')
export class RevisionController {
  constructor(private readonly revisionService: RevisionService) {}

  @Post()
  async create(@Body() createRevisionDto: CreateRevisionDto) {
    return this.revisionService.create(createRevisionDto);
  }

  @Get(':id')
  async findAllById(@Param('id') id: string) {
    return this.revisionService.findAllById(id);
  }
}
