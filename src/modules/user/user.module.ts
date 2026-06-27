import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { FirebaseService } from '../../config/firebase.service';
import { MailModule } from '../mail/mail.module';
import { AdminSecretGuard } from '../whatsapp/admin-secret.guard';
import { UserController } from './user.controller';
import { UserService } from './user.service';

@Module({
  imports: [JwtModule.register({}), MailModule],
  controllers: [UserController],
  providers: [UserService, FirebaseService, AdminSecretGuard],
})
export class UserModule {}
