import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import { DeploymentService } from '../deployment/deployment.service';
import { GithubAppService } from './github-app.service';
import { isGithubInstallationBoundToWorkspace } from '../common/security/github-installation-binding';

/**
 * GitHub Webhook 接收服务（KI-012 / R2-01 / R2-02）。
 *
 * 关键约束：
 * - HMAC 签名必须用 timing-safe 比较；缺失或非法直接 401。
 * - delivery 去重走 Prisma 唯一约束（P2002 = 重复）。
 * - 项目仅按 installationId + repositoryId 精确匹配；禁止跨租户 URL 兜底。
 * - 创建部署必须经 DeploymentService.createAutomated；幂等键 = github:{projectId}:{envId}:{commit}。
 * - 推送非默认分支 / CI 未通过 / 环境禁用等都会落 IGNORED / BLOCKED_CI 状态以便回溯。
 */

interface GitHubPushPayload {
  ref?: string;
  after?: string;
  repository?: {
    id?: number | string;
    full_name?: string;
    clone_url?: string;
    html_url?: string;
  };
  installation?: { id?: number | string };
}

@Injectable()
export class WebhookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deployments: DeploymentService,
    private readonly githubApp: GithubAppService,
  ) {}

  /**
   * 接收并处理 GitHub webhook 请求。
   * 返回值包含 accepted / ignored / blocked / duplicate / deploymentId 等字段，
   * 控制面可用其驱动 UI 状态展示。
   */
  async receiveGithub(input: {
    deliveryId?: string;
    event?: string;
    signature?: string;
    rawBody: Buffer;
    body: any;
  }) {
    const secret = process.env.LAUNCHLY_GITHUB_WEBHOOK_SECRET;
    if (!secret) throw new ServiceUnavailableException('GitHub webhook 未配置');
    if (!input.deliveryId || !input.event || !this.validSignature(secret, input.rawBody, input.signature)) {
      throw new UnauthorizedException('签名或 delivery 非法');
    }

    const payloadHash = createHash('sha256').update(input.rawBody).digest('hex');
    try {
      await this.prisma.gitWebhookDelivery.create({
        data: { provider: 'GITHUB', deliveryId: input.deliveryId, event: input.event, payloadHash },
      });
    } catch (error: any) {
      if (error?.code === 'P2002') return { accepted: true, duplicate: true };
      throw error;
    }

    if (input.event !== 'push') return { accepted: true, ignored: true };

    const payload = input.body as GitHubPushPayload;
    const repository = payload.repository;
    const installationId = payload.installation?.id ? String(payload.installation.id) : null;
    const repositoryId = repository?.id != null ? String(repository.id) : null;
    const repositoryUrl = repository?.clone_url || repository?.html_url;
    const ref = String(payload.ref || '');
    const commitSha = payload.after;
    if (!repositoryUrl || !ref.startsWith('refs/heads/') || !commitSha || /^0+$/.test(commitSha)) {
      return { accepted: true, ignored: true };
    }

    const branch = ref.slice('refs/heads/'.length);

    // KI-012: 优先按 installationId + repositoryId 定位项目；URL 仅做兜底。
    const project = await this.matchProject({ installationId, repositoryId });
    if (!project) {
      await this.recordDelivery(input.deliveryId, { commitSha, status: 'IGNORED' });
      return { accepted: true, ignored: true };
    }

    const environment = await this.prisma.environment.findFirst({
      where: {
        projectId: project.id,
        enabled: { not: false },
        OR: [
          { branchPattern: branch },
          { branchPattern: null, type: branch === 'develop' ? 'TEST' : branch === 'main' ? 'PRODUCTION' : '__NONE__' },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!environment || !environment.autoDeploy) {
      await this.recordDelivery(input.deliveryId, { projectId: project.id, commitSha, status: 'IGNORED' });
      return { accepted: true, ignored: true };
    }

    if (environment.requireCi) {
      const effectiveInstallation = installationId || project.githubInstallationId || '';
      const checksPassed = effectiveInstallation && this.githubApp.isConfigured()
        ? await this.githubApp.commitChecksPassed(effectiveInstallation, repositoryUrl, commitSha)
        : false;
      if (!checksPassed) {
        await this.recordDelivery(input.deliveryId, { projectId: project.id, commitSha, status: 'BLOCKED_CI' });
        return { accepted: true, blocked: 'CI 未通过或未配置' };
      }
    }

    const deployment = await this.deployments.createAutomated({
      projectId: project.id,
      environmentId: environment.id,
      branch,
      commitSha,
      idempotencyKey: `github:${project.id}:${environment.id}:${commitSha}`,
    });
    await this.recordDelivery(input.deliveryId, {
      projectId: project.id,
      commitSha,
      deploymentId: deployment.id,
      status: 'QUEUED',
    });
    return { accepted: true, deploymentId: deployment.id };
  }

  private async matchProject(criteria: { installationId: string | null; repositoryId: string | null }): Promise<{ id: string; githubInstallationId: string | null; workspaceId: string } | null> {
    if (!criteria.installationId || !criteria.repositoryId) return null;
    const project = await this.prisma.project.findFirst({
      where: {
        sourceType: 'GITHUB_APP',
        githubInstallationId: criteria.installationId,
        githubRepositoryId: criteria.repositoryId,
      },
      select: { id: true, githubInstallationId: true, workspaceId: true },
    });
    if (!project || !isGithubInstallationBoundToWorkspace(criteria.installationId, project.workspaceId)) return null;
    return project;
  }

  private async recordDelivery(
    deliveryId: string,
    fields: { projectId?: string; commitSha?: string; deploymentId?: string; status: string },
  ) {
    try {
      await this.prisma.gitWebhookDelivery.update({
        where: { provider_deliveryId: { provider: 'GITHUB', deliveryId } },
        data: {
          projectId: fields.projectId ?? null,
          commitSha: fields.commitSha ?? null,
          deploymentId: fields.deploymentId ?? null,
          status: fields.status,
        },
      });
    } catch {
      // 记录失败不阻塞主流程；属于运维可观测性补充。
    }
  }

  private validSignature(secret: string, rawBody: Buffer, header?: string): boolean {
    if (!header?.startsWith('sha256=')) return false;
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const received = header.slice('sha256='.length);
    if (expected.length !== received.length) return false;
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'));
  }

}
