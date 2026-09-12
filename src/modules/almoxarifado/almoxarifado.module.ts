import { Module } from '@nestjs/common';
import { AlmoxarifadoController } from './almoxarifado.controller';
import { AlmoxarifadoService } from './almoxarifado.service';
import { IdempotencyInterceptor } from '../../common/idempotency.interceptor';

@Module({
  controllers: [AlmoxarifadoController],
  providers: [AlmoxarifadoService, IdempotencyInterceptor],
  exports: [AlmoxarifadoService],
})
export class AlmoxarifadoModule {}
