import { Module } from '@nestjs/common';
import { PostosController } from './postos.controller';
import { PostosService } from './postos.service';

@Module({
  controllers: [PostosController],
  providers: [PostosService],
  exports: [PostosService],
})
export class PostosModule {}
