import { Module } from '@nestjs/common';
import { RevisionService } from './revision.service';
import { FirebaseService } from '../services/firebase.service';
import { RevisionController } from './revision.controller';

@Module({
  controllers: [RevisionController],
  providers: [RevisionService, FirebaseService],
})
export class RevisionModule {}
