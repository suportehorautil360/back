import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { VehiclesModule } from './modules/vehicles/vehicles.module';
import { RevisionModule } from './modules/revision/revision.module';
import { WorkFrontModule } from './modules/work-front/work-front.module';
import { AllocationsModule } from './modules/allocations/allocations.module';
import { TimeRecordsModule } from './modules/time-records/time-records.module';
import { SolicitacoesPontoModule } from './modules/solicitacoes-ponto/solicitacoes-ponto.module';
import { NotificacoesModule } from './modules/notificacoes/notificacoes.module';
import { AbonosModule } from './modules/abonos/abonos.module';
import { EscalaModule } from './modules/escala/escala.module';
import { FeatureFlagsModule } from './modules/feature-flags/feature-flags.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    VehiclesModule,
    RevisionModule,
    WorkFrontModule,
    AllocationsModule,
    TimeRecordsModule,
    SolicitacoesPontoModule,
    NotificacoesModule,
    AbonosModule,
    EscalaModule,
    FeatureFlagsModule,
    // ... outros módulos
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
