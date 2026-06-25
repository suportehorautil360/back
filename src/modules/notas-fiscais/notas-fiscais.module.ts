import { Module } from '@nestjs/common';
import { FirebaseService } from '../../config/firebase.service';
import { UploadsModule } from '../uploads/uploads.module';
import { NotasFiscaisController } from './notas-fiscais.controller';
import { NotasFiscaisService } from './notas-fiscais.service';

@Module({
  imports: [UploadsModule],
  controllers: [NotasFiscaisController],
  providers: [NotasFiscaisService, FirebaseService],
  exports: [NotasFiscaisService],
})
export class NotasFiscaisModule {}
