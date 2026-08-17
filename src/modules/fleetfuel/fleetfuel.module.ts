import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { IdempotencyInterceptor } from '../../common/idempotency.interceptor';
import { FleetfuelController } from './fleetfuel.controller';
import { FleetfuelService } from './fleetfuel.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [FleetfuelController],
  providers: [FleetfuelService, IdempotencyInterceptor],
  exports: [FleetfuelService],
})
export class FleetfuelModule {}
