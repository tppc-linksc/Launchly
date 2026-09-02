import { ForbiddenException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 统一的项目资源访问策略（KI-004 / R0-04）。
 *
 * 目标：
 * 1. 任意项目子资源（Environment / EnvironmentVariable / DeployTarget / Issue / Release / Test / TestRun / Deployment）
 *    的读写都通过本策略校验 Workspace 边界和角色级别，避免 URL 中 projectId 与数据库真实归属不一致。
 * 2. 角色使用受限字符串集合；未知值直接拒绝（KI-018），不再降级为 VIEWER。
 * 3. 与 ProjectAccessService 职责分明：
 *    - ProjectAccessService 负责项目主接口与历史兼容路径；
 *    - ProjectResourceAccessPolicy 是新策略，供所有子资源 Controller 注入。
 *
 * 用法：
 * ```ts
 * await this.accessPolicy.requireRelease(id, user.userId, user.workspaceId!, 'VIEWER');
 * ```
 */

/** 项目级角色集合（与 Prisma 中 ProjectMember.role 字段对齐）。 */
export const PROJECT_ROLES = ['VIEWER', 'TESTER', 'DEVELOPER', 'ADMIN', 'OWNER'] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

/** 角色级别映射：级别越高权限越大；不允许运行时动态新增。 */
const ROLE_LEVELS: Record<ProjectRole, number> = {
  VIEWER: 1,
  TESTER: 2,
  DEVELOPER: 3,
  ADMIN: 4,
  OWNER: 5,
};

/** 断言角色字符串合法；不合法则抛 500，fail closed（KI-018）。 */
function requireKnownRole(role: unknown, label: string): ProjectRole {
  if (typeof role !== 'string' || !(PROJECT_ROLES as readonly string[]).includes(role)) {
    throw new InternalServerErrorException(`${label} 角色非法: ${JSON.stringify(role)}`);
  }
  return role as ProjectRole;
}

@Injectable()
export class ProjectResourceAccessPolicy {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 校验调用者对指定项目是否拥有至少给定级别权限，并返回项目行。
   * 工作空间 OWNER 拥有项目级最高权限，无需再校验项目成员。
   */
  async requireProject(
    projectId: string,
    userId: string,
    workspaceId: string,
    minimumRole: ProjectRole | string = 'VIEWER',
  ) {
    if (!projectId || !userId || !workspaceId) throw new ForbiddenException('缺少工作空间访问上下文');
    const requiredLevel = ROLE_LEVELS[requireKnownRole(minimumRole, 'minimumRole')];

    const project = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId },
    });
    if (!project) {
      throw new NotFoundException('项目不存在');
    }

    const workspaceMember = await this.prisma.workspaceMember.findFirst({
      where: { workspaceId, userId },
    });
    if (!workspaceMember) throw new ForbiddenException('当前用户不是工作空间成员');
    if (workspaceMember.role === 'OWNER') return project;

    const projectMember = await this.prisma.projectMember.findFirst({
      where: { projectId, userId },
    });
    if (!projectMember) {
      throw new ForbiddenException('缺少项目级权限');
    }

    const membershipLevel = ROLE_LEVELS[requireKnownRole(projectMember.role, 'membership')];
    if (membershipLevel < requiredLevel) {
      throw new ForbiddenException('缺少项目级权限');
    }
    return project;
  }

  /** Environment 子资源：先按 ID 反查所属 projectId，再走统一校验。 */
  async requireEnvironment(
    environmentId: string,
    userId: string,
    workspaceId: string,
    minimumRole: ProjectRole | string = 'VIEWER',
  ) {
    const env = await this.prisma.environment.findUnique({
      where: { id: environmentId },
      select: { projectId: true },
    });
    if (!env) throw new NotFoundException('环境不存在');
    return this.requireProject(env.projectId, userId, workspaceId, minimumRole);
  }

  /** EnvironmentVariable 子资源：通过所属 Environment 反查项目。 */
  async requireEnvironmentVariable(
    variableId: string,
    userId: string,
    workspaceId: string,
    minimumRole: ProjectRole | string = 'VIEWER',
  ) {
    const variable = await this.prisma.environmentVariable.findUnique({
      where: { id: variableId },
      select: { environment: { select: { projectId: true } } },
    });
    if (!variable || !variable.environment) throw new NotFoundException('环境变量不存在');
    return this.requireProject(variable.environment.projectId, userId, workspaceId, minimumRole);
  }

  /** DeployTarget 子资源。 */
  async requireDeployTarget(
    targetId: string,
    userId: string,
    workspaceId: string,
    minimumRole: ProjectRole | string = 'VIEWER',
  ) {
    const target = await this.prisma.deployTarget.findUnique({
      where: { id: targetId },
      select: { projectId: true },
    });
    if (!target) throw new NotFoundException('部署目标不存在');
    return this.requireProject(target.projectId, userId, workspaceId, minimumRole);
  }

  /** Issue 子资源。 */
  async requireIssue(
    issueId: string,
    userId: string,
    workspaceId: string,
    minimumRole: ProjectRole | string = 'VIEWER',
  ) {
    const issue = await this.prisma.issue.findUnique({
      where: { id: issueId },
      select: { projectId: true },
    });
    if (!issue) throw new NotFoundException('问题不存在');
    return this.requireProject(issue.projectId, userId, workspaceId, minimumRole);
  }

  /** Release 子资源。 */
  async requireRelease(
    releaseId: string,
    userId: string,
    workspaceId: string,
    minimumRole: ProjectRole | string = 'VIEWER',
  ) {
    const release = await this.prisma.release.findUnique({
      where: { id: releaseId },
      select: { projectId: true },
    });
    if (!release) throw new NotFoundException('发布不存在');
    return this.requireProject(release.projectId, userId, workspaceId, minimumRole);
  }

  /** TestCase 子资源。 */
  async requireTestCase(
    testCaseId: string,
    userId: string,
    workspaceId: string,
    minimumRole: ProjectRole | string = 'VIEWER',
  ) {
    const tc = await this.prisma.testCase.findUnique({
      where: { id: testCaseId },
      select: { projectId: true },
    });
    if (!tc) throw new NotFoundException('测试用例不存在');
    return this.requireProject(tc.projectId, userId, workspaceId, minimumRole);
  }

  /** TestRun 子资源。 */
  async requireTestRun(
    testRunId: string,
    userId: string,
    workspaceId: string,
    minimumRole: ProjectRole | string = 'VIEWER',
  ) {
    const tr = await this.prisma.testRun.findUnique({
      where: { id: testRunId },
      select: { projectId: true },
    });
    if (!tr) throw new NotFoundException('测试运行不存在');
    return this.requireProject(tr.projectId, userId, workspaceId, minimumRole);
  }

  /** Deployment 子资源：用于跨项目边界校验（KI-004 触发面）。 */
  async requireDeployment(
    deploymentId: string,
    userId: string,
    workspaceId: string,
    minimumRole: ProjectRole | string = 'VIEWER',
  ) {
    const dep = await this.prisma.deployment.findUnique({
      where: { id: deploymentId },
      select: { projectId: true },
    });
    if (!dep) throw new NotFoundException('部署不存在');
    return this.requireProject(dep.projectId, userId, workspaceId, minimumRole);
  }
}
