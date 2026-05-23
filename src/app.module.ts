import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { VehiclesModule } from './vehicles/vehicles.module';
import { RevisionModule } from './revision/revision.module';
// ... seus outros imports (como o VehiclesModule)

@Module({
  imports: [
    // Isso carrega o arquivo .env para o projeto inteiro
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
