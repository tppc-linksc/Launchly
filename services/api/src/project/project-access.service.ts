import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class ProjectAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async require(projectId: string, userId: string, workspaceId: string, minimumRole = 'VIEWER') {
    if (!projectId || !userId || !workspaceId) throw new ForbiddenException('缺少工作空间访问上下文');
    const project = await this.prisma.project.findFirst({ where: { id: projectId, workspaceId } });
    if (!project) throw new NotFoundException('项目不存在');
    const workspaceMember = await this.prisma.workspaceMember.findFirst({ where: { workspaceId, userId } });
    if (!workspaceMember) throw new ForbiddenException('当前用户不是工作空间成员');
    if (workspaceMember.role === 'OWNER') return project;
    const membership = await this.prisma.projectMember.findFirst({ where: { projectId, userId } });
    const levels: Record<string, number> = { VIEWER: 1, TESTER: 2, DEVELOPER: 3, ADMIN: 4, OWNER: 5 };
    if (!membership || (levels[membership.role] || 0) < (levels[minimumRole] || 1)) throw new ForbiddenException('缺少项目级权限');
    return project;
  }
}
