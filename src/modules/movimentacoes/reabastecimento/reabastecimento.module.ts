import { Module } from '@nestjs/common';
import { IdempotencyInterceptor } from '../../../common/idempotency.interceptor';
import { ReabastecimentoController } from './reabastecimento.controller';
import { ReabastecimentoService } from './reabastecimento.service';

@Module({
  controllers: [ReabastecimentoController],
  providers: [ReabastecimentoService, IdempotencyInterceptor],
  exports: [ReabastecimentoService],
})
export class ReabastecimentoModule {}
