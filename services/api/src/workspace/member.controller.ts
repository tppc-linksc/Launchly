import { Controller, Get, Put, Delete, Param, Body, ForbiddenException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CurrentUser, AuthPrincipal } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('members')
export class MemberController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@CurrentUser() user: AuthPrincipal) {
    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId: user.workspaceId },
      include: { user: true },
    });
    return members.map(m => ({
      id: m.id,
      userId: m.userId,
      account: m.user.account,
      displayName: m.user.displayName,
      role: m.role,
      createdAt: m.createdAt.toISOString(),
    }));
  }

  @Roles('OWNER')
  @Put(':id/role')
  async updateRole(@Param('id') id: string, @Body('role') newRole: string, @CurrentUser() user: AuthPrincipal) {
    const member = await this.prisma.workspaceMember.findFirst({
      where: { id, workspaceId: user.workspaceId },
    });
    if (!member) throw new ForbiddenException('成员不存在');

    const validRoles = ['OWNER', 'ADMIN', 'DEVELOPER', 'TESTER', 'VIEWER'];
    if (!validRoles.includes(newRole)) throw new ForbiddenException('无效角色');

    await this.prisma.workspaceMember.update({
      where: { id },
      data: { role: newRole },
    });
    return { success: true };
  }

  @Roles('OWNER')
  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: AuthPrincipal) {
    const member = await this.prisma.workspaceMember.findFirst({
      where: { id, workspaceId: user.workspaceId },
    });
    if (!member) throw new ForbiddenException('成员不存在');

    // Prevent removing the last owner
    if (member.role === 'OWNER') {
      const ownerCount = await this.prisma.workspaceMember.count({
        where: { workspaceId: user.workspaceId, role: 'OWNER' },
      });
      if (ownerCount <= 1) throw new ConflictException('不能移除最后一个 Owner');
    }

    await this.prisma.workspaceMember.delete({ where: { id } });
    return { success: true };
  }
}
