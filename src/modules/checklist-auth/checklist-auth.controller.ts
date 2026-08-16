import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { ChecklistChassiService } from './checklist-chassi.service';
import { ResolverChassiDto } from './dto/resolver-chassi.dto';
import { SalvarChecklistRunDto } from './dto/salvar-checklist-run.dto';
import { SalvarEmergenciaDto } from './dto/salvar-emergencia.dto';

@ApiTags('checklist')
@Controller('checklist')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 10, ttl: 60_000 } })
export class ChecklistAuthController {
  constructor(private readonly service: ChecklistChassiService) {}

  @Post('resolver-chassi')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resolve empresa/máquina a partir do chassi (público, rate-limited).' })
  async resolver(@Body() dto: ResolverChassiDto) {
    return this.service.resolverChassi(dto.chassi);
  }

  @Get('chassis-empresa/:empresaId')
  @ApiOperation({ summary: 'Lista chassis da empresa para cache offline (público, rate-limited).' })
  async chassisEmpresa(@Param('empresaId') empresaId: string) {
    return this.service.listarChassisDaEmpresa(empresaId);
  }

  @Post('salvar-run')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Grava checklist no Postgres (login por chassi, sem sessão Supabase).',
  })
  async salvarRun(@Body() dto: SalvarChecklistRunDto) {
    return this.service.salvarChecklistRun(dto);
  }

  @Post('salvar-emergencia')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Grava emergência no Postgres (login por chassi, sem sessão Supabase).',
  })
  async salvarEmergencia(@Body() dto: SalvarEmergenciaDto) {
    return this.service.salvarEmergencia(dto);
  }

  @Get("runs/:empresaId")
  @ApiOperation({
    summary:
      "Lista checklists da empresa (login por chassi, sem sessão Supabase).",
  })
  async listarRuns(@Param("empresaId") empresaId: string) {
    return this.service.listarRunsEmpresa(empresaId);
  }
}
