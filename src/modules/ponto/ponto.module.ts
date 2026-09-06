import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { OperadorGuard } from '../../common/operador.guard';
import { PontoController } from './ponto.controller';
import { PontoService } from './ponto.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [PontoController],
  providers: [PontoService, OperadorGuard],
})
export class PontoModule {}
