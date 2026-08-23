import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [UsersController],
  providers: [UsersService, JwtAuthGuard],
})
export class UsersModule {}
