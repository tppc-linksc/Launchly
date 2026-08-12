import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import { DeploymentService } from '../deployment/deployment.service';
import { GithubAppService } from './github-app.service';

@Injectable()
export class WebhookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deployments: DeploymentService,
    private readonly githubApp: GithubAppService,
  ) {}

  async receiveGithub(input: { deliveryId?: string; event?: string; signature?: string; rawBody: Buffer; body: any }) {
    const secret = process.env.LAUNCHLY_GITHUB_WEBHOOK_SECRET;
    if (!secret) throw new ServiceUnavailableException('GitHub webhook is not configured');
    if (!input.deliveryId || !input.event || !this.validSignature(secret, input.rawBody, input.signature)) {
      throw new UnauthorizedException('Invalid GitHub webhook signature or delivery id');
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
    const repositoryUrl = input.body?.repository?.clone_url || input.body?.repository?.html_url;
    const ref = String(input.body?.ref || '');
    const commitSha = input.body?.after;
    if (!repositoryUrl || !ref.startsWith('refs/heads/') || !commitSha || /^0+$/.test(commitSha)) {
      return { accepted: true, ignored: true };
    }

    const branch = ref.slice('refs/heads/'.length);
    const projects = await this.prisma.project.findMany({ where: { repositoryUrl: { not: null } } });
    const project = projects.find(candidate => this.sameRepository(candidate.repositoryUrl!, repositoryUrl));
    if (!project) return { accepted: true, ignored: true };

    const environment = await this.prisma.environment.findFirst({
      where: {
        projectId: project.id,
        enabled: { not: false },
        OR: [{ branchPattern: branch }, { branchPattern: null, type: branch === 'develop' ? 'TEST' : branch === 'main' ? 'PRODUCTION' : '__NONE__' }],
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!environment || !environment.autoDeploy) {
      await this.prisma.gitWebhookDelivery.update({
        where: { provider_deliveryId: { provider: 'GITHUB', deliveryId: input.deliveryId } },
        data: { projectId: project.id, commitSha, status: 'IGNORED' },
      });
      return { accepted: true, ignored: true };
    }
    if (environment.requireCi) {
      const installationId = project.githubInstallationId || String(input.body?.installation?.id || '');
      const checksPassed = installationId && this.githubApp.isConfigured()
        ? await this.githubApp.commitChecksPassed(installationId, repositoryUrl, commitSha)
        : false;
      if (!checksPassed) {
        await this.prisma.gitWebhookDelivery.update({
          where: { provider_deliveryId: { provider: 'GITHUB', deliveryId: input.deliveryId } },
          data: { projectId: project.id, commitSha, status: 'BLOCKED_CI' },
        });
        return { accepted: true, blocked: 'CI checks are required and have not passed' };
      }
    }

    const deployment = await this.deployments.createAutomated({
      projectId: project.id,
      environmentId: environment.id,
      branch,
      commitSha,
      idempotencyKey: `github:${project.id}:${environment.id}:${commitSha}`,
    });
    await this.prisma.gitWebhookDelivery.update({
      where: { provider_deliveryId: { provider: 'GITHUB', deliveryId: input.deliveryId } },
      data: { projectId: project.id, commitSha, deploymentId: deployment.id, status: 'QUEUED' },
    });
    return { accepted: true, deploymentId: deployment.id };
  }

  private validSignature(secret: string, rawBody: Buffer, header?: string): boolean {
    if (!header?.startsWith('sha256=')) return false;
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const received = header.slice('sha256='.length);
    if (expected.length !== received.length) return false;
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'));
  }

  private sameRepository(left: string, right: string): boolean {
    const normalize = (value: string) => value.trim().toLowerCase().replace(/^git@github\.com:/, 'https://github.com/').replace(/\.git\/?$/, '').replace(/\/$/, '');
    return normalize(left) === normalize(right);
  }
}
