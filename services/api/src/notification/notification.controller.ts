import { Controller, Get, Put } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { CurrentUser, AuthPrincipal } from '../common/decorators/current-user.decorator';

@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  async list(@CurrentUser() user: AuthPrincipal) {
    return this.notificationService.list(user.userId);
  }

  @Put('read-all')
  async markAllRead(@CurrentUser() user: AuthPrincipal) {
    return this.notificationService.markAllRead(user.userId);
  }
}
