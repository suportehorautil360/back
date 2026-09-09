import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { FirebaseService } from '../../config/firebase.service';
import { CargosPermissaoController } from './cargos-permissao.controller';
import { CargosPermissaoService } from './cargos-permissao.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [CargosPermissaoController],
  providers: [JwtAuthGuard, CargosPermissaoService, FirebaseService],
  exports: [CargosPermissaoService],
})
export class CargosPermissaoModule {}
