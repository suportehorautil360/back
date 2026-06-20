import { Module } from '@nestjs/common';
import { FirebaseService } from '../../../config/firebase.service';
import { IdempotencyInterceptor } from '../../../common/idempotency.interceptor';
import { AbastecimentosController } from './abastecimentos.controller';
import { AbastecimentosService } from './abastecimentos.service';

@Module({
  controllers: [AbastecimentosController],
  providers: [AbastecimentosService, FirebaseService, IdempotencyInterceptor],
  exports: [AbastecimentosService],
})
export class AbastecimentosModule {}
