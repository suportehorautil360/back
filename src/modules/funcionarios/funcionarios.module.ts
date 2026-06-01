import { Module } from '@nestjs/common';
import { FuncionariosController } from './funcionarios.controller';
import { FuncionariosService } from './funcionarios.service';
import { FirebaseService } from '../../config/firebase.service';

@Module({
  controllers: [FuncionariosController],
  providers: [FuncionariosService, FirebaseService],
})
export class FuncionariosModule {}
