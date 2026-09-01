import { Injectable, ForbiddenException, NotFoundException, BadRequestException, Optional } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CreateDeploymentDto } from './dto/create-deployment.dto';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class DeploymentService {
  constructor(private readonly prisma: PrismaService, @Optional() private readonly audit?: AuditService) {}

  async create(
    dto: CreateDeploymentDto,
    userId: string,
    workspaceId: string,
    options: { idempotencyKey?: string; triggerSource?: string } = {},
  ) {
    const env = await this.prisma.environment.findUnique({ where: { id: dto.environmentId } });
    if (!env) throw new NotFoundException('环境不存在: ' + dto.environmentId);
    if (env.enabled === false) throw new BadRequestException('该环境已禁用，无法部署');
    if (env.projectId !== dto.projectId) throw new BadRequestException('环境不属于指定项目');

    const project = await this.prisma.project.findUnique({ where: { id: dto.projectId } });
    if (!project || project.workspaceId !== workspaceId) {
      throw new ForbiddenException('无权在该项目中创建部署');
    }
    this.assertDeployableProject(project);

    const targetId = dto.deployTargetId || env.deployTargetId;
    if (!targetId) throw new BadRequestException('环境未绑定部署目标');
    const target = await this.prisma.deployTarget.findUnique({ where: { id: targetId } });
    if (!target || target.projectId !== dto.projectId) {
      throw new NotFoundException('部署目标不存在或不属于指定项目');
    }
    const externalPort = await this.reserveExternalPort(env, target.id);
    const effectiveEnvironment = { ...env, externalPort, deployTargetId: target.id };

    const deployment = await this.prisma.$transaction(async (tx) => {
      const d = await tx.deployment.create({
        data: {
          projectId: dto.projectId,
          environmentId: dto.environmentId,
          deployTargetId: target.id,
          branch: dto.branch,
          commitSha: dto.commitSha,
          status: 'PENDING',
          triggeredBy: userId || null,
          idempotencyKey: options.idempotencyKey,
          triggerSource: options.triggerSource,
        },
      });

      const stages = this.deploymentStages(project);
      await tx.deploymentStageLog.createMany({
        data: stages.map(s => ({
          deploymentId: d.id,
          stage: s.stage,
          stepOrder: s.stepOrder,
          status: s.status || 'PENDING',
        })),
      });

      const payload = this.buildWorkerPayload({ project, environment: effectiveEnvironment, target, branch: dto.branch, commitSha: dto.commitSha });
      await tx.task.create({
        data: {
          taskType: this.initialTaskType(project),
          refId: d.id,
          payload: JSON.stringify(payload),
          idempotencyKey: `${this.initialTaskType(project).toLowerCase()}:${d.id}`,
        },
      });

      return d;
    });

    await this.audit?.record(userId || null, project.workspaceId, 'DEPLOYMENT_QUEUED', 'DEPLOYMENT', deployment.id, {
      projectId: project.id, environmentId: env.id, trigger: userId ? 'MANUAL' : 'AUTOMATED', commitSha: dto.commitSha || null,
    });
    return this.enrichDeployment(deployment);
  }

  /** Creates a deployment only after a provider webhook has been verified. */
  async createAutomated(input: {
    projectId: string;
    environmentId: string;
    branch: string;
    commitSha: string;
    idempotencyKey: string;
  }) {
    const existing = await this.prisma.deployment.findFirst({
      where: { idempotencyKey: input.idempotencyKey },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) return this.enrichDeployment(existing);

    const project = await this.prisma.project.findUnique({ where: { id: input.projectId } });
    if (!project) throw new NotFoundException('项目不存在');
    const target = await this.prisma.deployTarget.findFirst({ where: { projectId: input.projectId }, orderBy: { createdAt: 'asc' } });
    if (!target) throw new BadRequestException('自动部署需要已验证的部署目标');
    let deployment: any;
    try {
      deployment = await this.create({
        projectId: input.projectId,
        environmentId: input.environmentId,
        deployTargetId: target.id,
        branch: input.branch,
        commitSha: input.commitSha,
      }, '', project.workspaceId, {
        triggerSource: 'GITHUB_WEBHOOK',
        idempotencyKey: input.idempotencyKey,
      });
    } catch (error: any) {
      if (error?.code !== 'P2002') throw error;
      const winner = await this.prisma.deployment.findFirst({ where: { idempotencyKey: input.idempotencyKey } });
      if (!winner) throw error;
      return this.enrichDeployment(winner);
    }
    await this.audit?.record(null, project.workspaceId, 'DEPLOYMENT_WEBHOOK_QUEUED', 'DEPLOYMENT', deployment.id, {
      projectId: project.id, environmentId: input.environmentId, commitSha: input.commitSha,
    });
    return { ...deployment, triggerSource: 'GITHUB_WEBHOOK' };
  }

  async rollback(deploymentId: string, userId: string, workspaceId: string) {
    const source = await this.prisma.deployment.findFirst({
      where: { id: deploymentId, project: { workspaceId } },
    });
    if (!source) throw new NotFoundException('Deployment not found');
    if (!source.commitSha) throw new BadRequestException('Cannot rollback deployment without commitSha');

    const project = await this.prisma.project.findUnique({ where: { id: source.projectId } });
    if (!project) throw new ForbiddenException('无权操作');
    this.assertDeployableProject(project);

    const env = await this.prisma.environment.findUnique({ where: { id: source.environmentId } });
    if (!env) throw new NotFoundException('环境不存在: ' + source.environmentId);

    let target: any = null;
    if (source.deployTargetId) {
      target = await this.prisma.deployTarget.findUnique({ where: { id: source.deployTargetId } });
    }

    const rollback = await this.prisma.$transaction(async (tx) => {
      const d = await tx.deployment.create({
        data: {
          projectId: source.projectId,
          environmentId: source.environmentId,
          deployTargetId: source.deployTargetId,
          branch: source.branch,
          commitSha: source.commitSha,
          rollbackFromDeploymentId: source.id,
          status: 'PENDING',
          triggeredBy: userId,
        },
      });

      const stages = this.deploymentStages(project);
      await tx.deploymentStageLog.createMany({
        data: stages.map(s => ({
          deploymentId: d.id,
          stage: s.stage,
          stepOrder: s.stepOrder,
          status: s.status || 'PENDING',
        })),
      });

      const payload = this.buildWorkerPayload({ project, environment: env, target, branch: source.branch, commitSha: source.commitSha });
      await tx.task.create({
        data: {
          taskType: this.initialTaskType(project),
          refId: d.id,
          payload: JSON.stringify(payload),
          idempotencyKey: `${this.initialTaskType(project).toLowerCase()}:${d.id}`,
        },
      });

      return d;
    });

    await this.audit?.record(userId, project.workspaceId, 'DEPLOYMENT_ROLLBACK_REQUESTED', 'DEPLOYMENT', rollback.id, { rollbackFromDeploymentId: source.id });
    return this.enrichDeployment(rollback);
  }

  async listByProject(projectId: string, workspaceId: string) {
    const deployments = await this.prisma.deployment.findMany({
      where: { projectId, project: { workspaceId } },
      orderBy: { createdAt: 'desc' },
    });
    return this.enrichDeployments(deployments);
  }

  async listByEnvironment(environmentId: string, workspaceId: string) {
    const deployments = await this.prisma.deployment.findMany({
      where: { environmentId, project: { workspaceId } },
      orderBy: { createdAt: 'desc' },
    });
    return this.enrichDeployments(deployments);
  }

  async listForWorkspace(workspaceId: string) {
    const deployments = await this.prisma.deployment.findMany({
      where: { project: { workspaceId } },
      orderBy: { createdAt: 'desc' },
    });
    return this.enrichDeployments(deployments);
  }

  async getById(id: string, workspaceId: string) {
    const d = await this.prisma.deployment.findFirst({
      where: { id, project: { workspaceId } },
      include: { deployTarget: true },
    });
    if (!d) throw new NotFoundException('Deployment not found');

    let result: any = {
      id: d.id,
      projectId: d.projectId,
      environmentId: d.environmentId,
      deployTargetId: d.deployTargetId,
      branch: d.branch,
      commitSha: d.commitSha,
      status: d.status,
      triggeredBy: d.triggeredBy,
      accessUrl: d.accessUrl,
      startedAt: d.startedAt?.toISOString(),
      finishedAt: d.finishedAt?.toISOString(),
      errorMessage: d.errorMessage,
      createdAt: d.createdAt.toISOString(),
    };

    if (d.deployTarget) {
      result.deployTarget = {
        id: d.deployTarget.id,
        name: d.deployTarget.name,
        type: d.deployTarget.type,
        host: d.deployTarget.host,
      };
    }

    if (d.triggeredBy) {
      const user = await this.prisma.user.findUnique({ where: { id: d.triggeredBy } });
      if (user) result.triggeredByName = user.displayName;
    }
    if (d.environmentId) {
      const env = await this.prisma.environment.findUnique({ where: { id: d.environmentId } });
      if (env) result.environmentName = env.name;
    }

    return result;
  }

  async getLogs(id: string, workspaceId: string) {
    const d = await this.prisma.deployment.findFirst({
      where: { id, project: { workspaceId } },
      select: { id: true },
    });
    if (!d) throw new NotFoundException('Deployment not found');

    return this.prisma.deploymentStageLog.findMany({
      where: { deploymentId: id },
      orderBy: { stepOrder: 'asc' },
    });
  }

  private buildWorkerPayload(input: {
    project: any;
    environment: any;
    target: any;
    branch?: string | null;
    commitSha?: string | null;
  }) {
    const containerPort = input.project.defaultPort ?? (input.project.templateId === 'static-blog' ? 80 : 3000);
    const externalPort = input.environment.externalPort ?? containerPort;

    return {
      projectId: input.project.id,
      environmentId: input.environment.id,
      deployTargetId: input.target?.id ?? '',
      repositoryUrl: input.project.repositoryUrl,
      sourceType: input.project.sourceType || 'GIT_PUBLIC',
      resourceKind: input.project.resourceKind || 'APPLICATION',
      runtimeMode: input.project.runtimeMode || 'BUILDKIT',
      imageReference: input.project.imageReference || null,
      templateId: input.project.templateId || null,
      templateTitle: input.project.name,
      branch: input.branch || input.project.defaultBranch || 'main',
      commitSha: input.commitSha || '',
      installCommand: input.project.installCommand || null,
      buildCommand: input.project.buildCommand || null,
      startCommand: input.project.startCommand || null,
      testCommand: input.project.testCommand || null,
      healthCheckPath: input.project.healthCheckPath || '/',
      bootstrapAdminEnabled: Boolean(input.project.bootstrapAdminEnabled && input.project.bootstrapAdminCommand),
      bootstrapAdminCommand: input.project.bootstrapAdminCommand || null,
      bootstrapAdminUsername: input.project.bootstrapAdminUsername || null,
      bootstrapAdminEmail: input.project.bootstrapAdminEmail || null,
      domain: input.environment.domain || null,
      // port stays the externally reachable port for backward-compatible workers/logs.
      port: externalPort,
      containerPort,
      externalPort,
      healthPort: externalPort,
      host: input.target?.host || input.environment.host || 'localhost',
      deployMode: input.environment.deployMode || 'local',
      deployDir: input.environment.deployDir || null,
    };
  }

  private assertDeployableProject(project: any) {
    const sourceType = project.sourceType || 'GIT_PUBLIC';
    if (['GIT_PUBLIC', 'GITHUB_APP', 'DEPLOY_KEY'].includes(sourceType) && !project.repositoryUrl) {
      throw new BadRequestException('Git 资源必须配置代码仓库');
    }
    if (sourceType === 'OCI_IMAGE' && !project.imageReference) {
      throw new BadRequestException('OCI 镜像资源必须配置不可变镜像引用');
    }
    if (sourceType === 'TEMPLATE' && project.templateId === 'static-blog' && project.registryRepository) return;
    if (!['GIT_PUBLIC', 'GITHUB_APP', 'DEPLOY_KEY', 'OCI_IMAGE'].includes(sourceType)) {
      throw new BadRequestException(`资源来源 ${sourceType} 当前仅可保存配置，尚未具备安全发布执行器`);
    }
  }

  /**
   * Reserves the port on the environment row. A database unique constraint on
   * (deployTargetId, externalPort) closes the read/choose/update race between API requests.
   */
  private async reserveExternalPort(environment: any, deployTargetId: string): Promise<number> {
    const desired = environment.externalPort || 3000;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const environments = await this.prisma.environment.findMany({
        where: { deployTargetId },
        select: { id: true, externalPort: true },
      }) || [];
      const used = new Set<number>(environments
        .filter((candidate: any) => candidate.id !== environment.id)
        .map((candidate: any) => candidate.externalPort)
        .filter((port: unknown): port is number => Number.isInteger(port)));
      let selected = desired;
      if (used.has(selected)) {
        selected = -1;
        for (let candidate = Math.max(10000, desired + 1); candidate <= 60000; candidate += 1) {
          if (!used.has(candidate)) {
            selected = candidate;
            break;
          }
        }
      }
      if (selected === -1) throw new BadRequestException('部署目标没有可用的回退访问端口');
      if (environment.externalPort === selected && environment.deployTargetId === deployTargetId) return selected;
      try {
        await this.prisma.environment.update({
          where: { id: environment.id },
          data: { externalPort: selected, deployTargetId },
        });
        return selected;
      } catch (error: any) {
        if (error?.code !== 'P2002') throw error;
        // Another request reserved this candidate; refresh the occupied set and retry.
      }
    }
    throw new BadRequestException('并发部署端口分配冲突，请重试');
  }

  private initialTaskType(project: any): string {
    if ((project.sourceType || 'GIT_PUBLIC') === 'OCI_IMAGE') return 'PROJECT_IMAGE_PREPARE';
    if (project.sourceType === 'TEMPLATE') return 'TEMPLATE_SOURCE';
    return 'REPO_CLONE';
  }

  private deploymentStages(project: any): Array<{ stage: string; stepOrder: number; status?: string }> {
    const bootstrap = Boolean(project.bootstrapAdminEnabled && project.bootstrapAdminCommand);
    if ((project.sourceType || 'GIT_PUBLIC') === 'OCI_IMAGE') {
      const stages = [
        { stage: 'CLONE', stepOrder: 1, status: 'SKIPPED' },
        { stage: 'BUILD', stepOrder: 2 },
        { stage: 'DEPLOY', stepOrder: 3 },
      ];
      if (bootstrap) stages.push({ stage: 'BOOTSTRAP', stepOrder: 4 });
      stages.push({ stage: 'HEALTH_CHECK', stepOrder: bootstrap ? 5 : 4 });
      return stages;
    }
    const stages = [
      { stage: 'CLONE', stepOrder: 1 },
      { stage: 'BUILD', stepOrder: 2 },
      { stage: 'DEPLOY', stepOrder: 3 },
    ];
    if (bootstrap) stages.push({ stage: 'BOOTSTRAP', stepOrder: 4 });
    stages.push({ stage: 'HEALTH_CHECK', stepOrder: bootstrap ? 5 : 4 });
    return stages;
  }

  private async enrichDeployments(deployments: any[]) {
    return Promise.all(deployments.map(d => this.enrichDeployment(d)));
  }

  private async enrichDeployment(d: any) {
    const result: any = {
      id: d.id,
      projectId: d.projectId,
      environmentId: d.environmentId,
      deployTargetId: d.deployTargetId,
      branch: d.branch,
      commitSha: d.commitSha,
      status: d.status,
      triggeredBy: d.triggeredBy,
      accessUrl: d.accessUrl,
      startedAt: d.startedAt?.toISOString(),
      finishedAt: d.finishedAt?.toISOString(),
      errorMessage: d.errorMessage,
      createdAt: d.createdAt.toISOString(),
    };

    if (d.triggeredBy) {
      const user = await this.prisma.user.findUnique({ where: { id: d.triggeredBy } });
      if (user) result.triggeredByName = user.displayName;
    }
    if (d.environmentId) {
      const env = await this.prisma.environment.findUnique({ where: { id: d.environmentId } });
      if (env) result.environmentName = env.name;
    }

    return result;
  }
}
