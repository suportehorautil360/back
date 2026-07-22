import { Module } from '@nestjs/common';
import { FirebaseService } from '../../config/firebase.service';
import { CargosPermissaoController } from './cargos-permissao.controller';
import { CargosPermissaoService } from './cargos-permissao.service';

@Module({
  controllers: [CargosPermissaoController],
  providers: [CargosPermissaoService, FirebaseService],
  exports: [CargosPermissaoService],
})
export class CargosPermissaoModule {}
