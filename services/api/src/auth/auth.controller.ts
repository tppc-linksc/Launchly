import { Controller, Post, Body, Get } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginRequestDto } from './dto/login-request.dto';
import { SetupOwnerRequestDto } from './dto/setup-owner-request.dto';
import { Public } from '../common/decorators/public.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  async login(@Body() dto: LoginRequestDto) {
    return this.authService.login(dto.account, dto.password);
  }

  @Public()
  @Post('refresh')
  async refresh(@Body('refreshToken') refreshToken: string) {
    return this.authService.refresh(refreshToken);
  }
}

@Controller('setup')
export class SetupController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Get('status')
  async status() {
    return this.authService.getStatus();
  }

  @Public()
  @Post('owner')
  async createOwner(@Body() dto: SetupOwnerRequestDto) {
    return this.authService.createOwner(dto.account, dto.password, dto.displayName || null, dto.workspaceName);
  }
}
