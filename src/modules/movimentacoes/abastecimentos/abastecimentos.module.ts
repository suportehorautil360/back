import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { IdempotencyInterceptor } from '../../../common/idempotency.interceptor';
import { MotoristaGuard } from '../../../common/motorista.guard';
import { PostoGuard } from '../../../common/posto.guard';
import { AbastecimentosController } from './abastecimentos.controller';
import { AbastecimentosService } from './abastecimentos.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AbastecimentosController],
  providers: [
    AbastecimentosService,
    IdempotencyInterceptor,
    MotoristaGuard,
    PostoGuard,
  ],
  exports: [AbastecimentosService],
})
export class AbastecimentosModule {}
