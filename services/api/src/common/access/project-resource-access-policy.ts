import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProjectResourceAccessPolicy {
  private readonly roleLevels: Record<string, number> = {
    VIEWER: 1,
    TESTER: 2,
    DEVELOPER: 3,
    ADMIN: 4,
    OWNER: 5,
  };

  constructor(private readonly prisma: PrismaService) {}

  async requireProject(projectId: string, userId: string, workspaceId: string, minimumRole = 'VIEWER') {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId },
    });
    if (!project) throw new ForbiddenException('项目不存在或不属于当前工作空间');

    const workspaceMember = await this.prisma.workspaceMember.findFirst({ where: { workspaceId, userId } });
    if (workspaceMember?.role === 'OWNER') return project;

    const projectMember = await this.prisma.projectMember.findFirst({ where: { projectId, userId } });
    if (!projectMember) throw new ForbiddenException('缺少项目级权限');

    const membershipLevel = this.requireKnownRole(projectMember.role, 'membership');
    const requiredLevel = this.requireKnownRole(minimumRole, 'minimumRole');
    if (membershipLevel < requiredLevel) throw new ForbiddenException('缺少项目级权限');

    return project;
  }

  async requireEnvironment(environmentId: string, userId: string, workspaceId: string, minimumRole = 'VIEWER') {
    const environment = await this.prisma.environment.findUnique({
      where: { id: environmentId },
      select: { projectId: true },
    });
    if (!environment) throw new NotFoundException('环境不存在');

    return this.requireProject(environment.projectId, userId, workspaceId, minimumRole);
  }

  async requireEnvironmentVariable(variableId: string, userId: string, workspaceId: string, minimumRole = 'VIEWER') {
    const variable = await this.prisma.environmentVariable.findUnique({
      where: { id: variableId },
      select: {
        environment: {
          select: { projectId: true },
        },
      },
    });
    if (!variable || !variable.environment) throw new NotFoundException('变量不存在');

    return this.requireProject(variable.environment.projectId, userId, workspaceId, minimumRole);
  }

  async requireDeployTarget(targetId: string, userId: string, workspaceId: string, minimumRole = 'VIEWER') {
    const target = await this.prisma.deployTarget.findUnique({
      where: { id: targetId },
      select: { projectId: true },
    });
    if (!target) throw new NotFoundException('Deploy target not found');

    return this.requireProject(target.projectId, userId, workspaceId, minimumRole);
  }

  async requireIssue(issueId: string, userId: string, workspaceId: string, minimumRole = 'VIEWER') {
    const issue = await this.prisma.issue.findUnique({
      where: { id: issueId },
      select: { projectId: true },
    });
    if (!issue) throw new NotFoundException('Issue not found');

    return this.requireProject(issue.projectId, userId, workspaceId, minimumRole);
  }

  async requireRelease(releaseId: string, userId: string, workspaceId: string, minimumRole = 'VIEWER') {
    const release = await this.prisma.release.findUnique({
      where: { id: releaseId },
      select: { projectId: true },
    });
    if (!release) throw new NotFoundException('Release not found');

    return this.requireProject(release.projectId, userId, workspaceId, minimumRole);
  }

  async requireDeployment(deploymentId: string, userId: string, workspaceId: string, minimumRole = 'VIEWER') {
    const deployment = await this.prisma.deployment.findUnique({
      where: { id: deploymentId },
      select: { projectId: true },
    });
    if (!deployment) throw new NotFoundException('Deployment not found');

    return this.requireProject(deployment.projectId, userId, workspaceId, minimumRole);
  }

  async requireTestCase(testCaseId: string, userId: string, workspaceId: string, minimumRole = 'VIEWER') {
    const testCase = await this.prisma.testCase.findUnique({
      where: { id: testCaseId },
      select: { projectId: true },
    });
    if (!testCase) throw new NotFoundException('Test case not found');

    return this.requireProject(testCase.projectId, userId, workspaceId, minimumRole);
  }

  async requireTestRun(testRunId: string, userId: string, workspaceId: string, minimumRole = 'VIEWER') {
    const testRun = await this.prisma.testRun.findUnique({
      where: { id: testRunId },
      select: { projectId: true },
    });
    if (!testRun) throw new NotFoundException('Test run not found');

    return this.requireProject(testRun.projectId, userId, workspaceId, minimumRole);
  }

  private requireKnownRole(role: string, context: string) {
    const level = this.roleLevels[role];
    if (level === undefined) throw new ForbiddenException(`${context}: ${role}`);
    return level;
  }
}
