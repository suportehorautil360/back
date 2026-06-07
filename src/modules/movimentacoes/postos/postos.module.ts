import { Module } from '@nestjs/common';
import { FirebaseService } from '../../../config/firebase.service';
import { PostosController } from './postos.controller';
import { PostosService } from './postos.service';

@Module({
  controllers: [PostosController],
  providers: [PostosService, FirebaseService],
  exports: [PostosService],
})
export class PostosModule {}
