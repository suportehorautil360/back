import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { FinanceiroController } from './financeiro.controller';
import { FinanceiroService } from './financeiro.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [FinanceiroController],
  providers: [JwtAuthGuard, FinanceiroService],
})
export class FinanceiroModule {}
