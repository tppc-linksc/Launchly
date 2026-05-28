import { Module } from '@nestjs/common';
import { AuthController, SetupController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  controllers: [AuthController, SetupController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
