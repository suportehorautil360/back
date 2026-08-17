import { Module } from '@nestjs/common';
import { IdempotencyInterceptor } from '../../../common/idempotency.interceptor';
import { LubrificacoesController } from './lubrificacoes.controller';
import { LubrificacoesService } from './lubrificacoes.service';

@Module({
  controllers: [LubrificacoesController],
  providers: [LubrificacoesService, IdempotencyInterceptor],
  exports: [LubrificacoesService],
})
export class LubrificacoesModule {}
