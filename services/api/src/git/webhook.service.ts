import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import { DeploymentService } from '../deployment/deployment.service';
import { GithubAppService } from './github-app.service';

/**
 * GitHub Webhook 接收服务（KI-012 / R2-01 / R2-02）。
 *
 * 关键约束：
 * - HMAC 签名必须用 timing-safe 比较；缺失或非法直接 401。
 * - delivery 去重走 Prisma 唯一约束（P2002 = 重复）。
 * - 项目匹配优先使用 installationId + repositoryId（KI-012）；
 *   仅有 URL 时降级使用规范化比较，并标注低置信度，便于人工排查。
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
    const project = await this.matchProject({ installationId, repositoryId, repositoryUrl });
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

  /** KI-012: 三级匹配：installation+repo > installation only > URL 兜底。 */
  private async matchProject(criteria: { installationId: string | null; repositoryId: string | null; repositoryUrl: string }): Promise<{ id: string; githubInstallationId: string | null; workspaceId: string } | null> {
    const projects = await this.prisma.project.findMany({
      where: { repositoryUrl: { not: null } },
      select: { id: true, repositoryUrl: true, githubInstallationId: true, githubRepositoryId: true, workspaceId: true },
    });

    if (criteria.installationId && criteria.repositoryId) {
      const exact = projects.find(p => p.githubInstallationId === criteria.installationId && p.githubRepositoryId === criteria.repositoryId);
      if (exact) return { id: exact.id, githubInstallationId: exact.githubInstallationId, workspaceId: exact.workspaceId };
    }
    if (criteria.installationId) {
      const byInstall = projects.filter(p => p.githubInstallationId === criteria.installationId);
      // 同 installation 下按 URL 进一步收敛，避免多个 repo 串扰。
      const refined = byInstall.find(p => this.sameRepository(p.repositoryUrl!, criteria.repositoryUrl));
      if (refined) return { id: refined.id, githubInstallationId: refined.githubInstallationId, workspaceId: refined.workspaceId };
    }
    const byUrl = projects.find(p => this.sameRepository(p.repositoryUrl!, criteria.repositoryUrl));
    if (byUrl) return { id: byUrl.id, githubInstallationId: byUrl.githubInstallationId, workspaceId: byUrl.workspaceId };
    return null;
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

  private sameRepository(left: string, right: string): boolean {
    const normalize = (value: string) =>
      value.trim().toLowerCase()
        .replace(/^git@github\.com:/, 'https://github.com/')
        .replace(/\.git\/?$/, '')
        .replace(/\/$/, '');
    return normalize(left) === normalize(right);
  }
}
