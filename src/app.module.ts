import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { VehiclesModule } from './modules/vehicles/vehicles.module';
import { RevisionModule } from './modules/revision/revision.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    VehiclesModule,
    RevisionModule,
    // ... outros módulos
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
