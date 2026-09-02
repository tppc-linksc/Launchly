import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { createHash, randomBytes } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';

@Injectable()
export class InvitationService {
  constructor(private readonly prisma: PrismaService) {}

  async create(workspaceId: string, dto: CreateInvitationDto) {
    const rawToken = randomBytes(32).toString('base64url');
    const invitation = await this.prisma.invitation.create({
      data: {
        workspaceId,
        role: dto.role,
        token: this.hashToken(rawToken),
        expiresAt: new Date(Date.now() + (dto.expiresInHours ?? 72) * 60 * 60 * 1000),
        maxUses: dto.maxUses ?? 1,
      },
    });
    return {
      id: invitation.id,
      role: invitation.role,
      token: rawToken,
      expiresAt: invitation.expiresAt.toISOString(),
      maxUses: invitation.maxUses,
    };
  }

  async list(workspaceId: string) {
    return this.prisma.invitation.findMany({
      where: { workspaceId },
      select: { id: true, role: true, expiresAt: true, maxUses: true, usedCount: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async accept(rawToken: string, dto: AcceptInvitationDto) {
    if (!rawToken || rawToken.length > 255) throw new NotFoundException('邀请不存在或已失效');
    const token = this.hashToken(rawToken);
    const invitation = await this.prisma.invitation.findUnique({ where: { token } });
    if (
      !invitation ||
      invitation.status !== 'ACTIVE' ||
      invitation.expiresAt <= new Date() ||
      invitation.usedCount >= invitation.maxUses
    ) {
      throw new NotFoundException('邀请不存在或已失效');
    }
    if (await this.prisma.user.findUnique({ where: { account: dto.account } })) {
      throw new ConflictException('账号已存在；当前 MVP 邀请仅用于创建新成员');
    }
    const passwordHash = await bcrypt.hash(dto.password, 10);
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.invitation.updateMany({
        where: {
          id: invitation.id,
          status: 'ACTIVE',
          expiresAt: { gt: new Date() },
          usedCount: { lt: invitation.maxUses },
        },
        data: { usedCount: { increment: 1 } },
      });
      if (claimed.count !== 1) throw new BadRequestException('邀请已被使用或已过期');
      const user = await tx.user.create({
        data: { account: dto.account, displayName: dto.displayName?.trim() || dto.account, passwordHash },
      });
      await tx.workspaceMember.create({
        data: { workspaceId: invitation.workspaceId, userId: user.id, role: invitation.role },
      });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          workspaceId: invitation.workspaceId,
          action: 'INVITATION_ACCEPTED',
          targetType: 'WORKSPACE',
          targetId: invitation.workspaceId,
          detail: JSON.stringify({ role: invitation.role }),
        },
      });
      if (invitation.usedCount + 1 >= invitation.maxUses) {
        await tx.invitation.update({ where: { id: invitation.id }, data: { status: 'CONSUMED' } });
      }
      return { success: true, account: user.account };
    });
  }

  private hashToken(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
