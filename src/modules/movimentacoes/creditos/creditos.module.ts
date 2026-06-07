import { Module } from '@nestjs/common';
import { FirebaseService } from '../../../config/firebase.service';
import { CreditosController } from './creditos.controller';
import { CreditosService } from './creditos.service';

@Module({
  controllers: [CreditosController],
  providers: [CreditosService, FirebaseService],
  exports: [CreditosService],
})
export class CreditosModule {}
