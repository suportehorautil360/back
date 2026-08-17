import { Module } from '@nestjs/common';
import { AbonosController } from './abonos.controller';
import { AbonosService } from './abonos.service';

@Module({
  controllers: [AbonosController],
  providers: [AbonosService],
  exports: [AbonosService],
})
export class AbonosModule {}
