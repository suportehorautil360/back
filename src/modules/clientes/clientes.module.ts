import { Module } from '@nestjs/common';
import { ClientesController } from './clientes.controller';
import { ClientesOficinasService } from './clientes-oficinas.service';
import { ClientesService } from './clientes.service';
import { FirebaseService } from '../../config/firebase.service';

@Module({
  controllers: [ClientesController],
  providers: [ClientesService, ClientesOficinasService, FirebaseService],
  exports: [ClientesOficinasService],
})
export class ClientesModule {}
