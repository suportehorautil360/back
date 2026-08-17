import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { EquipamentosController } from './equipamentos.controller';
import { EquipamentosService } from './equipamentos.service';
import { ComboistaGuard } from '../../common/comboista.guard';

@Module({
  imports: [JwtModule.register({})],
  controllers: [EquipamentosController],
  providers: [EquipamentosService, ComboistaGuard],
  exports: [EquipamentosService],
})
export class EquipamentosModule {}
