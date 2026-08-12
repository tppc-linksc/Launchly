import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class ProjectAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async require(projectId: string, userId: string, workspaceId: string, minimumRole = 'VIEWER') {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, workspaceId } });
    if (!project) throw new ForbiddenException('项目不存在或不属于当前工作空间');
    const workspaceMember = await this.prisma.workspaceMember.findFirst({ where: { workspaceId, userId } });
    if (workspaceMember?.role === 'OWNER') return project;
    const membership = await this.prisma.projectMember.findFirst({ where: { projectId, userId } });
    const levels: Record<string, number> = { VIEWER: 1, TESTER: 2, DEVELOPER: 3, ADMIN: 4, OWNER: 5 };
    if (!membership || (levels[membership.role] || 0) < (levels[minimumRole] || 1)) throw new ForbiddenException('缺少项目级权限');
    return project;
  }
}
