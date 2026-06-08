import { Module } from '@nestjs/common';
import { ClientesController } from './clientes.controller';
import { ClientesService } from './clientes.service';
import { FirebaseService } from '../../config/firebase.service';

@Module({
  controllers: [ClientesController],
  providers: [ClientesService, FirebaseService],
})
export class ClientesModule {}
