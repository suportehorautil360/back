import { Module } from '@nestjs/common';
import { FirebaseService } from '../../../config/firebase.service';
import { HistoricoController } from './historico.controller';
import { HistoricoService } from './historico.service';

@Module({
  controllers: [HistoricoController],
  providers: [HistoricoService, FirebaseService],
})
export class HistoricoModule {}
