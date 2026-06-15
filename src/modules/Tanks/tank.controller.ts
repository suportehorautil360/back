import { Controller, Get, Param } from '@nestjs/common';
import { TanksService } from './tanks.service';

@Controller('tanks')
export class TankController {
  constructor(private readonly tanksService: TanksService) {}

  @Get('by-comboio/:comboioId')
  findByComboio(@Param('comboioId') comboioId: string) {
    return this.tanksService.findByComboio(comboioId);
  }

  @Get(':prefeituraId')
  findAll(@Param('prefeituraId') prefeituraId: string) {
    return this.tanksService.findAll(prefeituraId);
  }
}
