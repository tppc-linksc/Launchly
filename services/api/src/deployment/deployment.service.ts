import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CreateDeploymentDto } from './dto/create-deployment.dto';

@Injectable()
export class DeploymentService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateDeploymentDto, userId: string, workspaceId: string) {
    // Validate environment
    const env = await this.prisma.environment.findUnique({ where: { id: dto.environmentId } });
    if (!env) throw new NotFoundException('环境不存在: ' + dto.environmentId);
    if (env.enabled === false) throw new BadRequestException('该环境已禁用，无法部署');
    if (env.projectId !== dto.projectId) throw new BadRequestException('环境不属于指定项目');

    // Validate project
    const project = await this.prisma.project.findUnique({ where: { id: dto.projectId } });
    if (!project || project.workspaceId !== workspaceId) {
      throw new ForbiddenException('无权在该项目中创建部署');
    }

    // Validate deploy target
    const target = await this.prisma.deployTarget.findUnique({ where: { id: dto.deployTargetId } });
    if (!target || target.projectId !== dto.projectId) {
      throw new NotFoundException('部署目标不存在或不属于指定项目');
    }

    // Create deployment + stage logs + first task in transaction
    const deployment = await this.prisma.$transaction(async (tx) => {
      const d = await tx.deployment.create({
        data: {
          projectId: dto.projectId,
          environmentId: dto.environmentId,
          deployTargetId: dto.deployTargetId,
          branch: dto.branch,
          commitSha: dto.commitSha,
          status: 'PENDING',
          triggeredBy: userId,
        },
      });

      // Create placeholder stage logs
      const stages = [
        { stage: 'CLONE', stepOrder: 1 },
        { stage: 'BUILD', stepOrder: 2 },
        { stage: 'DEPLOY', stepOrder: 3 },
        { stage: 'HEALTH_CHECK', stepOrder: 4 },
      ];
      await tx.deploymentStageLog.createMany({
        data: stages.map(s => ({
          deploymentId: d.id,
          stage: s.stage,
          stepOrder: s.stepOrder,
          status: 'PENDING',
        })),
      });

      // Enqueue first worker task
      await tx.task.create({
        data: {
          taskType: 'REPO_CLONE',
          refId: d.id,
          payload: JSON.stringify({
            projectId: d.projectId,
            environmentId: d.environmentId,
            deployTargetId: d.deployTargetId || '',
            branch: d.branch || '',
            commitSha: d.commitSha || '',
          }),
        },
      });

      return d;
    });

    return this.enrichDeployment(deployment);
  }

  async rollback(deploymentId: string, userId: string, workspaceId: string) {
    const source = await this.prisma.deployment.findUnique({ where: { id: deploymentId } });
    if (!source) throw new NotFoundException('Deployment not found: ' + deploymentId);
    if (!source.commitSha) throw new BadRequestException('Cannot rollback deployment without commitSha');

    const project = await this.prisma.project.findUnique({ where: { id: source.projectId } });
    if (!project || project.workspaceId !== workspaceId) {
      throw new ForbiddenException('无权操作');
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

      const stages = [
        { stage: 'CLONE', stepOrder: 1 },
        { stage: 'BUILD', stepOrder: 2 },
        { stage: 'DEPLOY', stepOrder: 3 },
        { stage: 'HEALTH_CHECK', stepOrder: 4 },
      ];
      await tx.deploymentStageLog.createMany({
        data: stages.map(s => ({
          deploymentId: d.id,
          stage: s.stage,
          stepOrder: s.stepOrder,
          status: 'PENDING',
        })),
      });

      await tx.task.create({
        data: {
          taskType: 'REPO_CLONE',
          refId: d.id,
          payload: JSON.stringify({
            projectId: d.projectId,
            environmentId: d.environmentId,
            deployTargetId: d.deployTargetId || '',
            branch: d.branch || '',
            commitSha: d.commitSha || '',
          }),
        },
      });

      return d;
    });

    return this.enrichDeployment(rollback);
  }

  async listByProject(projectId: string) {
    const deployments = await this.prisma.deployment.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
    return this.enrichDeployments(deployments);
  }

  async listByEnvironment(environmentId: string) {
    const deployments = await this.prisma.deployment.findMany({
      where: { environmentId },
      orderBy: { createdAt: 'desc' },
    });
    return this.enrichDeployments(deployments);
  }

  async listForWorkspace(workspaceId: string) {
    const projects = await this.prisma.project.findMany({
      where: { workspaceId },
      select: { id: true },
    });
    const projectIds = projects.map(p => p.id);

    const deployments = await this.prisma.deployment.findMany({
      where: { projectId: { in: projectIds } },
      orderBy: { createdAt: 'desc' },
    });
    return this.enrichDeployments(deployments);
  }

  async getById(id: string) {
    const d = await this.prisma.deployment.findUnique({
      where: { id },
      include: { deployTarget: true },
    });
    if (!d) throw new NotFoundException('Deployment not found: ' + id);

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

    // Enrich with names
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

  async getLogs(id: string) {
    return this.prisma.deploymentStageLog.findMany({
      where: { deploymentId: id },
      orderBy: { stepOrder: 'asc' },
    });
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
