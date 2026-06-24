import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { FirebaseService } from '../../config/firebase.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, FirebaseService],
})
export class AuthModule {}
