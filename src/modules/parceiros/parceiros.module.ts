import { Module } from '@nestjs/common';
import { ParceirosController } from './parceiros.controller';
import { ParceirosService } from './parceiros.service';

@Module({
  controllers: [ParceirosController],
  providers: [ParceirosService],
})
export class ParceirosModule {}
