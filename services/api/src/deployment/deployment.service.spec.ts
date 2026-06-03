import { ForbiddenException } from '@nestjs/common';
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

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new DeploymentService(prisma as any);

    // Default happy-path mocks
    prisma.environment.findUnique.mockResolvedValue({
      id: 'env-1',
      projectId: 'proj-1',
      enabled: true,
    });
    prisma.project.findUnique.mockResolvedValue({
      id: 'proj-1',
      workspaceId: 'ws-1',
    });
    prisma.deployTarget.findUnique.mockResolvedValue({
      id: 'target-1',
      projectId: 'proj-1',
    });
    // $transaction mock: pass the callback through with `prisma` as the tx
    prisma.$transaction.mockImplementation(async (fn: any) => {
      const tx = {
        deployment: { create: jest.fn().mockResolvedValue({ id: 'deploy-1', ...baseDto, status: 'PENDING', triggeredBy: userId, createdAt: new Date() }) },
        deploymentStageLog: { createMany: jest.fn().mockResolvedValue({ count: 4 }) },
        task: { create: jest.fn().mockResolvedValue({ id: 'task-1' }) },
      };
      return fn(tx);
    });
    // enrichDeployment needs user/env lookups
    prisma.user.findUnique.mockResolvedValue({ id: userId, displayName: 'Test User' });
  });

  it('should throw ForbiddenException if environment not found', async () => {
    prisma.environment.findUnique.mockResolvedValue(null);
    await expect(service.create(baseDto, userId, workspaceId)).rejects.toThrow(ForbiddenException);
  });

  it('should throw ForbiddenException if environment is disabled', async () => {
    prisma.environment.findUnique.mockResolvedValue({
      id: 'env-1', projectId: 'proj-1', enabled: false,
    });
    await expect(service.create(baseDto, userId, workspaceId)).rejects.toThrow(ForbiddenException);
  });

  it('should throw ForbiddenException if environment does not belong to project', async () => {
    prisma.environment.findUnique.mockResolvedValue({
      id: 'env-1', projectId: 'other-proj', enabled: true,
    });
    await expect(service.create(baseDto, userId, workspaceId)).rejects.toThrow(ForbiddenException);
  });

  it('should throw ForbiddenException if project not found or workspace mismatch', async () => {
    prisma.project.findUnique.mockResolvedValue(null);
    await expect(service.create(baseDto, userId, workspaceId)).rejects.toThrow(ForbiddenException);
  });

  it('should throw ForbiddenException if deploy target not found or does not belong to project', async () => {
    prisma.deployTarget.findUnique.mockResolvedValue(null);
    await expect(service.create(baseDto, userId, workspaceId)).rejects.toThrow(ForbiddenException);
  });

  it('should create deployment, stage logs, and first task on success', async () => {
    const result = await service.create(baseDto, userId, workspaceId);

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(result).toBeDefined();
    expect(result.id).toBe('deploy-1');
    expect(result.status).toBe('PENDING');
  });
});
