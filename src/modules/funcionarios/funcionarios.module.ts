import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { FuncionariosController } from './funcionarios.controller';
import { FuncionariosService } from './funcionarios.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [FuncionariosController],
  providers: [FuncionariosService],
})
export class FuncionariosModule {}
