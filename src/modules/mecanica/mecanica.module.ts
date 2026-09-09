import { Module } from '@nestjs/common';
import { IdempotencyInterceptor } from '../../common/idempotency.interceptor';
import { UploadsModule } from '../uploads/uploads.module';
import { MecanicaController } from './mecanica.controller';
import { MecanicaService } from './mecanica.service';

@Module({
  imports: [UploadsModule],
  controllers: [MecanicaController],
  providers: [MecanicaService, IdempotencyInterceptor],
  exports: [MecanicaService],
})
export class MecanicaModule {}
