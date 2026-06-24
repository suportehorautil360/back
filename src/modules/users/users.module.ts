import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { FirebaseService } from '../../config/firebase.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [UsersController],
  providers: [UsersService, FirebaseService, JwtAuthGuard],
})
export class UsersModule {}
