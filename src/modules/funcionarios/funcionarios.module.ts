import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { FuncionariosController } from './funcionarios.controller';
import { FuncionariosService } from './funcionarios.service';
import { FirebaseService } from '../../config/firebase.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [FuncionariosController],
  providers: [FuncionariosService, FirebaseService],
})
export class FuncionariosModule {}
