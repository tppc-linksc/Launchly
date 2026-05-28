import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(userId: string, workspaceId: string | null, action: string, targetType: string, targetId: string, detail?: any) {
    return this.prisma.auditLog.create({
      data: {
        userId,
        workspaceId,
        action,
        targetType,
        targetId,
        detail: detail ? JSON.stringify(detail) : null,
      },
    });
  }

  async list(workspaceId: string, limit = 50, offset = 0) {
    return this.prisma.auditLog.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  async listForExport(workspaceId: string) {
    return this.prisma.auditLog.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
