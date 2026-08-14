import { Injectable } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class NotificationService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
    return { success: true };
  }

  async unreadCount(userId: string) {
    const count = await this.prisma.notification.count({
      where: { userId, read: false },
    });
    return { count };
  }

  async markRead(userId: string, notificationId: string) {
    const target = await this.prisma.notification.findUnique({
      where: { id: notificationId },
      select: { userId: true },
    });
    if (!target || target.userId !== userId) {
      throw new NotFoundException('notification not found');
    }

    await this.prisma.notification.update({
      where: { id: notificationId },
      data: { read: true },
    });
    return { success: true };
  }

  async create(userId: string, type: string, title: string, content?: string, refId?: string) {
    return this.prisma.notification.create({
      data: { userId, type, title, content, refId },
    });
  }
}
