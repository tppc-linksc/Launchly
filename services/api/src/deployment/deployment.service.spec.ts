import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { DeploymentService } from './deployment.service';
import { createPrismaMock, MockPrismaService } from '../../test/helpers/prisma-mock';

describe('DeploymentService.create', () => {
  let service: DeploymentService;
  let prisma: MockPrismaService;

  const userId = 'user-1';
  const workspaceId = 'ws-1';
  const baseDto = {
    projectId: 'proj-1',
    environmentId: 'env-1',
    deployTargetId: 'target-1',
    branch: 'main',
    commitSha: 'abc123',
  };

  const mockProject = {
    id: 'proj-1',
    workspaceId: 'ws-1',
    repositoryUrl: 'https://github.com/acme/app.git',
    defaultBranch: 'main',
    installCommand: 'pnpm install --frozen-lockfile',
    buildCommand: 'pnpm build',
    startCommand: 'node dist/main',
    healthCheckPath: '/health',
    defaultPort: 3000,
  };

  const mockEnv = {
    id: 'env-1',
    projectId: 'proj-1',
    enabled: true,
    externalPort: 3001,
    deployMode: 'local',
    host: 'localhost',
    deployDir: null,
  };

  const mockTarget = {
    id: 'target-1',
    projectId: 'proj-1',
    host: '192.168.1.100',
    port: 22,
    username: 'deploy',
  };

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new DeploymentService(prisma as any);

    prisma.environment.findUnique.mockResolvedValue(mockEnv);
    prisma.project.findUnique.mockResolvedValue(mockProject);
    prisma.deployTarget.findUnique.mockResolvedValue(mockTarget);
    prisma.$transaction.mockImplementation(async (fn: any) => {
      const tx = {
        deployment: { create: jest.fn().mockResolvedValue({ id: 'deploy-1', ...baseDto, status: 'PENDING', triggeredBy: userId, createdAt: new Date() }) },
        deploymentStageLog: { createMany: jest.fn().mockResolvedValue({ count: 4 }) },
        task: { create: jest.fn().mockResolvedValue({ id: 'task-1' }) },
      };
      return fn(tx);
    });
    prisma.user.findUnique.mockResolvedValue({ id: userId, displayName: 'Test User' });
  });

  it('should throw NotFoundException if environment not found', async () => {
    prisma.environment.findUnique.mockResolvedValue(null);
    await expect(service.create(baseDto, userId, workspaceId)).rejects.toThrow(NotFoundException);
  });

  it('should throw BadRequestException if environment is disabled', async () => {
    prisma.environment.findUnique.mockResolvedValue({ ...mockEnv, enabled: false });
    await expect(service.create(baseDto, userId, workspaceId)).rejects.toThrow(BadRequestException);
  });

  it('should throw BadRequestException if environment does not belong to project', async () => {
    prisma.environment.findUnique.mockResolvedValue({ ...mockEnv, projectId: 'other-proj' });
    await expect(service.create(baseDto, userId, workspaceId)).rejects.toThrow(BadRequestException);
  });

  it('should throw ForbiddenException if project not found or workspace mismatch', async () => {
    prisma.project.findUnique.mockResolvedValue(null);
    await expect(service.create(baseDto, userId, workspaceId)).rejects.toThrow(ForbiddenException);
  });

  it('should throw BadRequestException if project has no repositoryUrl', async () => {
    prisma.project.findUnique.mockResolvedValue({ ...mockProject, repositoryUrl: null });
    await expect(service.create(baseDto, userId, workspaceId)).rejects.toThrow(BadRequestException);
  });

  it('should throw NotFoundException if deploy target not found', async () => {
    prisma.deployTarget.findUnique.mockResolvedValue(null);
    await expect(service.create(baseDto, userId, workspaceId)).rejects.toThrow(NotFoundException);
  });

  it('should allow creating deployment without deployTargetId (local Docker)', async () => {
    const dto = { ...baseDto, deployTargetId: undefined };
    const result = await service.create(dto, userId, workspaceId);
    expect(result).toBeDefined();
    expect(result.id).toBe('deploy-1');
  });

  it('should create deployment with complete worker payload', async () => {
    await service.create(baseDto, userId, workspaceId);

    const tx = (prisma.$transaction as jest.Mock).mock.calls[0][0];
    const mockTx = {
      deployment: { create: jest.fn().mockResolvedValue({ id: 'deploy-1', ...baseDto, status: 'PENDING', triggeredBy: userId, createdAt: new Date() }) },
      deploymentStageLog: { createMany: jest.fn() },
      task: { create: jest.fn() },
    };
    await tx(mockTx);

    const taskCreate = mockTx.task.create as jest.Mock;
    const payload = JSON.parse(taskCreate.mock.calls[0][0].data.payload);

    expect(payload.repositoryUrl).toBe('https://github.com/acme/app.git');
    expect(payload.installCommand).toBe('pnpm install --frozen-lockfile');
    expect(payload.buildCommand).toBe('pnpm build');
    expect(payload.startCommand).toBe('node dist/main');
    expect(payload.healthCheckPath).toBe('/health');
    expect(payload.port).toBe(3001);
    expect(payload.branch).toBe('main');
    expect(payload.commitSha).toBe('abc123');
    expect(payload.host).toBe('192.168.1.100');
  });

  it('should create deployment and stage logs on success', async () => {
    const result = await service.create(baseDto, userId, workspaceId);
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(result).toBeDefined();
    expect(result.id).toBe('deploy-1');
    expect(result.status).toBe('PENDING');
  });
});

describe('DeploymentService.getById workspace isolation', () => {
  let service: DeploymentService;
  let prisma: MockPrismaService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new DeploymentService(prisma as any);
  });

  it('should throw NotFoundException for deployment in different workspace', async () => {
    prisma.deployment.findFirst.mockResolvedValue(null);
    await expect(service.getById('deploy-1', 'other-ws')).rejects.toThrow(NotFoundException);
  });

  it('should return deployment when workspace matches', async () => {
    prisma.deployment.findFirst.mockResolvedValue({
      id: 'deploy-1',
      projectId: 'proj-1',
      environmentId: 'env-1',
      deployTargetId: null,
      branch: 'main',
      commitSha: 'abc',
      status: 'PENDING',
      triggeredBy: 'user-1',
      accessUrl: null,
      startedAt: null,
      finishedAt: null,
      errorMessage: null,
      createdAt: new Date(),
      deployTarget: null,
    });
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', displayName: 'Test' });
    prisma.environment.findUnique.mockResolvedValue({ id: 'env-1', name: 'Production' });

    const result = await service.getById('deploy-1', 'ws-1');
    expect(result.id).toBe('deploy-1');
  });
});

describe('DeploymentService.getLogs workspace isolation', () => {
  let service: DeploymentService;
  let prisma: MockPrismaService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new DeploymentService(prisma as any);
  });

  it('should throw NotFoundException if deployment not in workspace', async () => {
    prisma.deployment.findFirst.mockResolvedValue(null);
    await expect(service.getLogs('deploy-1', 'other-ws')).rejects.toThrow(NotFoundException);
  });

  it('should return logs when workspace matches', async () => {
    prisma.deployment.findFirst.mockResolvedValue({ id: 'deploy-1' });
    prisma.deploymentStageLog.findMany.mockResolvedValue([{ stage: 'CLONE', status: 'SUCCEEDED' }]);

    const result = await service.getLogs('deploy-1', 'ws-1');
    expect(result).toHaveLength(1);
  });
});
