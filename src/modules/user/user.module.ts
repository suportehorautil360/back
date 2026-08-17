import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../../prisma/prisma.module';
import { MailModule } from '../mail/mail.module';
import { AdminSecretGuard } from '../whatsapp/admin-secret.guard';
import { UserController } from './user.controller';
import { UserService } from './user.service';

@Module({
  imports: [JwtModule.register({}), MailModule, PrismaModule],
  controllers: [UserController],
  providers: [UserService, AdminSecretGuard],
})
export class UserModule {}
