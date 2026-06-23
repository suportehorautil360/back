import { Module } from '@nestjs/common';
import { FirebaseService } from '../../../config/firebase.service';
import { IdempotencyInterceptor } from '../../../common/idempotency.interceptor';
import { LubrificacoesController } from './lubrificacoes.controller';
import { LubrificacoesService } from './lubrificacoes.service';

@Module({
  controllers: [LubrificacoesController],
  providers: [LubrificacoesService, FirebaseService, IdempotencyInterceptor],
  exports: [LubrificacoesService],
})
export class LubrificacoesModule {}
