import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { ParceirosController } from './parceiros.controller';
import { ParceirosService } from './parceiros.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [ParceirosController],
  providers: [JwtAuthGuard, ParceirosService],
})
export class ParceirosModule {}
