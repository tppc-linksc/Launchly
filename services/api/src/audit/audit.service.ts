import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

export const AUDIT_EXPORT_LIMIT = 10_000;

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(userId: string | null, workspaceId: string | null, action: string, targetType: string, targetId: string, detail?: any) {
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
      // Fetch one sentinel row so the controller can mark a truncated export.
      take: AUDIT_EXPORT_LIMIT + 1,
    });
  }
}
