import { Module } from '@nestjs/common';
import { ConfiguracoesModule } from '../configuracoes/configuracoes.module';
import { EscalaController } from './escala.controller';

@Module({
  imports: [ConfiguracoesModule],
  controllers: [EscalaController],
})
export class EscalaModule {}
