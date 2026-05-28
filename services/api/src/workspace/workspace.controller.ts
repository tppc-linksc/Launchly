import { Controller, Get, Put, Delete, Body, Param, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CurrentUser, AuthPrincipal } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('members')
export class WorkspaceController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@CurrentUser() user: AuthPrincipal) {
    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId: user.workspaceId },
    });
    const userIds = members.map((m) => m.userId);
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));
    return members.map((m) => {
      const u = userMap.get(m.userId);
      return {
        id: m.id,
        userId: m.userId,
        account: u?.account ?? 'unknown',
        displayName: u?.displayName ?? null,
        role: m.role,
        createdAt: m.createdAt.toISOString(),
      };
    });
  }

  @Put(':id/role')
  @Roles('OWNER')
  async updateRole(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body() body: { role: string },
  ) {
    const member = await this.prisma.workspaceMember.findUnique({ where: { id } });
    if (!member || member.workspaceId !== user.workspaceId) {
      throw new ForbiddenException('成员不存在');
    }
    const validRoles = ['OWNER', 'ADMIN', 'DEVELOPER', 'TESTER', 'VIEWER'];
    if (!body.role || !validRoles.includes(body.role)) {
      throw new ForbiddenException('无效的角色');
    }
    await this.prisma.workspaceMember.update({
      where: { id },
      data: { role: body.role },
    });
  }

  @Delete(':id')
  @Roles('OWNER')
  async remove(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    const member = await this.prisma.workspaceMember.findUnique({ where: { id } });
    if (!member || member.workspaceId !== user.workspaceId) {
      throw new ForbiddenException('成员不存在');
    }
    // Prevent removing the last owner
    if (member.role === 'OWNER') {
      const ownerCount = await this.prisma.workspaceMember.count({
        where: { workspaceId: user.workspaceId, role: 'OWNER' },
      });
      if (ownerCount <= 1) {
        throw new ForbiddenException('不能移除最后一个所有者');
      }
    }
    await this.prisma.workspaceMember.delete({ where: { id } });
  }
}
