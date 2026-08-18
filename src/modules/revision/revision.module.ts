import { Module } from '@nestjs/common';
import { RevisionService } from './revision.service';
import { RevisionController } from './revision.controller';

@Module({
  controllers: [RevisionController],
  providers: [RevisionService],
})
export class RevisionModule {}
