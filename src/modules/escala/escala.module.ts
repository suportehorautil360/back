import { Module } from '@nestjs/common';
import { EscalaController } from './escala.controller';
import { EscalaService } from './escala.service';
import { FirebaseService } from '../../config/firebase.service';

@Module({
  controllers: [EscalaController],
  providers: [EscalaService, FirebaseService],
})
export class EscalaModule {}
