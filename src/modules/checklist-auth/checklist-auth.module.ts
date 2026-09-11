import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ChecklistChassiService } from './checklist-chassi.service';
import { ChecklistAuthController } from './checklist-auth.controller';

@Module({
  // O login por chassi emite token próprio — ver `token-do-chassi.helper.ts`.
  imports: [JwtModule.register({})],
  controllers: [ChecklistAuthController],
  providers: [ChecklistChassiService],
  exports: [ChecklistChassiService],
})
export class ChecklistAuthModule {}
