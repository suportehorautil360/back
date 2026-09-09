import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { ClientesController } from './clientes.controller';
import { ClientesOficinasService } from './clientes-oficinas.service';
import { ClientesService } from './clientes.service';
import { FirebaseService } from '../../config/firebase.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [ClientesController],
  providers: [JwtAuthGuard, ClientesService, ClientesOficinasService, FirebaseService],
  exports: [ClientesOficinasService],
})
export class ClientesModule {}
