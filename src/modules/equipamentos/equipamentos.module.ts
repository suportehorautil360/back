import { Module } from '@nestjs/common';
import { EquipamentosController } from './equipamentos.controller';
import { EquipamentosService } from './equipamentos.service';
import { FirebaseService } from '../../config/firebase.service';

@Module({
  controllers: [EquipamentosController],
  providers: [EquipamentosService, FirebaseService],
})
export class EquipamentosModule {}
