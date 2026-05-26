import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { VehiclesModule } from './modules/vehicles/vehicles.module';
import { RevisionModule } from './modules/revision/revision.module';
import { WorkFrontModule } from './modules/work-front/work-front.module';
import { AllocationsModule } from './modules/allocations/allocations.module';
import { TimeRecordsModule } from './modules/time-records/time-records.module';
import { EscalaModule } from './modules/escala/escala.module';

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
    EscalaModule,
    // ... outros módulos
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
