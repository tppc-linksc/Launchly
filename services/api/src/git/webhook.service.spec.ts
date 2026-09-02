import { createHmac } from 'crypto';
import { ServiceUnavailableException } from '@nestjs/common';
import { WebhookService } from './webhook.service';

describe('WebhookService', () => {
  const secret = 'webhook-test-secret';
  const body = {
    ref: 'refs/heads/develop',
    after: 'a'.repeat(40),
    repository: { clone_url: 'https://github.com/acme/app.git' },
  };
  const rawBody = Buffer.from(JSON.stringify(body));
  const signature = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  let prisma: any;
  let deployments: any;
  let githubApp: any;
  let service: WebhookService;

  beforeEach(() => {
    process.env.LAUNCHLY_GITHUB_WEBHOOK_SECRET = secret;
    prisma = {
      gitWebhookDelivery: { create: vi.fn(), update: vi.fn() },
      project: { findFirst: vi.fn().mockResolvedValue(null) },
      environment: { findFirst: vi.fn() },
    };
    deployments = { createAutomated: vi.fn() };
    githubApp = { isConfigured: vi.fn().mockReturnValue(false), commitChecksPassed: vi.fn() };
    service = new WebhookService(prisma, deployments, githubApp);
  });

  afterEach(() => {
    delete process.env.LAUNCHLY_GITHUB_WEBHOOK_SECRET;
    delete process.env.LAUNCHLY_GITHUB_INSTALLATION_BINDINGS;
  });

  it('rejects webhook processing when no secret is configured', async () => {
    delete process.env.LAUNCHLY_GITHUB_WEBHOOK_SECRET;
    await expect(service.receiveGithub({ deliveryId: 'd1', event: 'push', signature, rawBody, body })).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('deduplicates a previously recorded provider delivery', async () => {
    prisma.gitWebhookDelivery.create.mockRejectedValue({ code: 'P2002' });
    await expect(service.receiveGithub({ deliveryId: 'd1', event: 'push', signature, rawBody, body })).resolves.toEqual(
      { accepted: true, duplicate: true },
    );
  });

  it('does not create deployments for repositories that are not connected to Launchly', async () => {
    await expect(service.receiveGithub({ deliveryId: 'd1', event: 'push', signature, rawBody, body })).resolves.toEqual(
      { accepted: true, ignored: true },
    );
    expect(deployments.createAutomated).not.toHaveBeenCalled();
  });

  it('rejects an exact repository match when its installation is not operator-bound to the workspace', async () => {
    prisma.project.findFirst.mockResolvedValue({ id: 'p1', githubInstallationId: '123', workspaceId: 'w1' });
    await expect((service as any).matchProject({ installationId: '123', repositoryId: '456' })).resolves.toBeNull();
  });

  it('accepts an exact repository match only when its installation is operator-bound to the workspace', async () => {
    process.env.LAUNCHLY_GITHUB_INSTALLATION_BINDINGS = JSON.stringify({ '123': 'w1' });
    const project = { id: 'p1', githubInstallationId: '123', workspaceId: 'w1' };
    prisma.project.findFirst.mockResolvedValue(project);
    await expect((service as any).matchProject({ installationId: '123', repositoryId: '456' })).resolves.toEqual(
      project,
    );
  });
});
