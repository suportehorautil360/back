import { Module } from '@nestjs/common';
import { AlmoxarifadoController } from './almoxarifado.controller';
import { AlmoxarifadoService } from './almoxarifado.service';
import { IdempotencyInterceptor } from '../../common/idempotency.interceptor';
import { ComprasController } from './compras/compras.controller';
import { ComprasService } from './compras/compras.service';
import { EstoqueMinimoAgendador } from './compras/estoque-minimo.agendador';

@Module({
  controllers: [AlmoxarifadoController, ComprasController],
  providers: [AlmoxarifadoService, ComprasService, EstoqueMinimoAgendador, IdempotencyInterceptor],
  exports: [AlmoxarifadoService],
})
export class AlmoxarifadoModule {}
