import { Controller, Body, Get, Param } from '@nestjs/common';
import { TanksService } from './tanks.service';

@Controller('tanks')
export class TankController {
  constructor(private readonly tanksService: TanksService) {}

  @Get(':prefeituraId')
  findAll(@Param('prefeituraId') prefeituraId: string) {
    return this.tanksService.findAll(prefeituraId);
  }
}
