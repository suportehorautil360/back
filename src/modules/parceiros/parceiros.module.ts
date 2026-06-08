import { Module } from '@nestjs/common';
import { ParceirosController } from './parceiros.controller';
import { ParceirosService } from './parceiros.service';
import { FirebaseService } from '../../config/firebase.service';

@Module({
  controllers: [ParceirosController],
  providers: [ParceirosService, FirebaseService],
})
export class ParceirosModule {}
