import { Module } from '@nestjs/common';
import { UploadsModule } from '../uploads/uploads.module';
import { MecanicaController } from './mecanica.controller';
import { MecanicaService } from './mecanica.service';

@Module({
  imports: [UploadsModule],
  controllers: [MecanicaController],
  providers: [MecanicaService],
  exports: [MecanicaService],
})
export class MecanicaModule {}
