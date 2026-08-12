import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ChecklistChassiService } from './checklist-chassi.service';
import { ResolverChassiDto } from './dto/resolver-chassi.dto';

@ApiTags('checklist')
@Controller('checklist')
export class ChecklistAuthController {
  constructor(private readonly service: ChecklistChassiService) {}

  @Post('resolver-chassi')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resolve empresa/máquina a partir do chassi (público, rate-limited).' })
  async resolver(@Body() dto: ResolverChassiDto) {
    return this.service.resolverChassi(dto.chassi);
  }
}
