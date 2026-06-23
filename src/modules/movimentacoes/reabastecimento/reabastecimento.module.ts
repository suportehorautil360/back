import { Module } from '@nestjs/common';
import { FirebaseService } from '../../../config/firebase.service';
import { IdempotencyInterceptor } from '../../../common/idempotency.interceptor';
import { ReabastecimentoController } from './reabastecimento.controller';
import { ReabastecimentoService } from './reabastecimento.service';

@Module({
  controllers: [ReabastecimentoController],
  providers: [ReabastecimentoService, FirebaseService, IdempotencyInterceptor],
  exports: [ReabastecimentoService],
})
export class ReabastecimentoModule {}
