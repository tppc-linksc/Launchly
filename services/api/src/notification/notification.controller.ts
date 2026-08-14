import { Controller, Get, Param, Put } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { CurrentUser, AuthPrincipal } from '../common/decorators/current-user.decorator';

@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  async list(@CurrentUser() user: AuthPrincipal) {
    return this.notificationService.list(user.userId);
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: AuthPrincipal) {
    return this.notificationService.unreadCount(user.userId);
  }

  @Put(':id/read')
  async markRead(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.notificationService.markRead(user.userId, id);
  }

  @Put('read-all')
  async markAllRead(@CurrentUser() user: AuthPrincipal) {
    return this.notificationService.markAllRead(user.userId);
  }
}
