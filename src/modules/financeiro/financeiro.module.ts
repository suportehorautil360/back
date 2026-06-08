import { Module } from '@nestjs/common';
import { FinanceiroController } from './financeiro.controller';
import { FinanceiroService } from './financeiro.service';
import { FirebaseService } from '../../config/firebase.service';

@Module({
  controllers: [FinanceiroController],
  providers: [FinanceiroService, FirebaseService],
})
export class FinanceiroModule {}
