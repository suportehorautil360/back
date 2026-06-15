import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { EquipamentosController } from './equipamentos.controller';
import { EquipamentosService } from './equipamentos.service';
import { FirebaseService } from '../../config/firebase.service';
import { ComboistaGuard } from '../../common/comboista.guard';

@Module({
  imports: [JwtModule.register({})],
  controllers: [EquipamentosController],
  providers: [EquipamentosService, FirebaseService, ComboistaGuard],
})
export class EquipamentosModule {}
