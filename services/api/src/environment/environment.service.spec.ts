import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { EnvironmentService } from './environment.service';
import { createPrismaMock, MockPrismaService } from '../../test/helpers/prisma-mock';

describe('EnvironmentService', () => {
  let service: EnvironmentService;
  let prisma: MockPrismaService;

  const workspaceId = 'ws-1';
  const projectId = 'proj-1';
  const envId = 'env-1';

  const projectInWorkspace = { id: projectId, workspaceId };
  const projectInOtherWorkspace = { id: 'proj-2', workspaceId: 'ws-OTHER' };
  const envRecord = { id: envId, projectId, name: 'production', type: 'PROD' };

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new EnvironmentService(prisma as any);
  });

  describe('listByProject', () => {
    it('queries Prisma with the exact projectId and orderBy type asc', async () => {
      const rows = [
        { id: 'e1', type: 'PROD' },
        { id: 'e2', type: 'STAGING' },
      ];
      prisma.environment.findMany.mockResolvedValue(rows);

      const result = await service.listByProject(projectId);

      expect(prisma.environment.findMany).toHaveBeenCalledWith({
        where: { projectId },
        orderBy: { type: 'asc' },
      });
      expect(result).toEqual(rows);
    });

    it('returns the raw Prisma result without modification', async () => {
      const row = { id: 'e1', projectId, customField: 'sentinel-value' };
      prisma.environment.findMany.mockResolvedValue([row as any]);

      const result = await service.listByProject(projectId);

      expect(result).toHaveLength(1);
      expect((result[0] as unknown as { customField: string }).customField).toBe('sentinel-value');
    });

    it('forwards the projectId argument verbatim (no rewriting or defaulting)', async () => {
      prisma.environment.findMany.mockResolvedValue([]);
      const odd = 'project-with-odd-id-#1';

      await service.listByProject(odd);

      expect(prisma.environment.findMany).toHaveBeenCalledWith({
        where: { projectId: odd },
        orderBy: { type: 'asc' },
      });
    });
  });

  describe('update - rejection paths', () => {
    it('throws NotFoundException when the environment does not exist', async () => {
      prisma.environment.findUnique.mockResolvedValue(null);

      await expect(service.update(envId, { name: 'x' }, workspaceId)).rejects.toThrow(NotFoundException);
      expect(prisma.environment.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the environment exists but its project does not', async () => {
      prisma.environment.findUnique.mockResolvedValue(envRecord);
      prisma.project.findUnique.mockResolvedValue(null);

      await expect(service.update(envId, { name: 'x' }, workspaceId)).rejects.toThrow(NotFoundException);
      expect(prisma.environment.update).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when the project belongs to a different workspace', async () => {
      prisma.environment.findUnique.mockResolvedValue({ ...envRecord, projectId: 'proj-2' });
      prisma.project.findUnique.mockResolvedValue(projectInOtherWorkspace);

      await expect(service.update(envId, { name: 'x' }, workspaceId)).rejects.toThrow(ForbiddenException);
      expect(prisma.environment.update).not.toHaveBeenCalled();
    });
  });

  describe('update - allowed fields and write contract', () => {
    beforeEach(() => {
      prisma.environment.findUnique.mockResolvedValue(envRecord);
      prisma.project.findUnique.mockResolvedValue(projectInWorkspace);
      prisma.environment.update.mockResolvedValue({ id: envId });
      prisma.environment.findFirst.mockResolvedValue(null);
      prisma.deployTarget.findUnique.mockResolvedValue({ projectId });
    });

    it('uses where = { id: current environmentId } and writes only the single allowed field', async () => {
      await service.update(envId, { name: 'new-name' }, workspaceId);

      const call = (prisma.environment.update as vi.Mock).mock.calls[0][0];
      expect(call.where).toEqual({ id: envId });
      expect(call.data).toEqual({ name: 'new-name' });
    });

    it('writes the full set of allowed fields including the falsy-but-not-null values', async () => {
      const dto = {
        name: 'new-name',
        url: 'https://app.example.com',
        deployMode: 'remote',
        host: '10.0.0.1',
        sshUser: 'deployer',
        deployDir: '/srv/app',
        localWorkRoot: '/tmp/work',
        externalPort: 0,
        dataStrategy: 'persist',
        enabled: false,
        autoDeploy: false,
        branchPattern: 'main',
        requireCi: false,
        deployTargetId: 'target-1',
      };

      await service.update(envId, dto, workspaceId);

      const call = (prisma.environment.update as vi.Mock).mock.calls[0][0];
      expect(call.where).toEqual({ id: envId });
      expect(call.data).toEqual(dto);
    });

    it('skips undefined and null entries (per the != null guard) but writes empty string', async () => {
      const dto: Record<string, unknown> = {
        name: 'keep',
        url: undefined,
        domain: undefined,
        host: null,
        deployDir: '',
      };

      await service.update(envId, dto as any, workspaceId);

      const data = (prisma.environment.update as vi.Mock).mock.calls[0][0].data;
      expect(data.name).toBe('keep');
      expect(data.deployDir).toBe('');
      expect('url' in data).toBe(false);
      expect('domain' in data).toBe(false);
      expect('host' in data).toBe(false);
    });

    it('does not leak DTO-external keys into Prisma data', async () => {
      const dto = { name: 'x', status: 'ACTIVE', projectId: 'injected' } as any;

      await service.update(envId, dto, workspaceId);

      const data = (prisma.environment.update as vi.Mock).mock.calls[0][0].data;
      expect('status' in data).toBe(false);
      expect('projectId' in data).toBe(false);
    });
  });

  describe('update - domain handling', () => {
    beforeEach(() => {
      prisma.environment.findUnique.mockResolvedValue(envRecord);
      prisma.project.findUnique.mockResolvedValue(projectInWorkspace);
      prisma.environment.update.mockResolvedValue({ id: envId });
      prisma.environment.findFirst.mockResolvedValue(null);
      prisma.deployTarget.findUnique.mockResolvedValue({ projectId });
    });

    it('normalises a valid domain to lowercased + trimmed and writes it', async () => {
      await service.update(envId, { domain: '  App.Example.COM  ' }, workspaceId);

      const data = (prisma.environment.update as vi.Mock).mock.calls[0][0].data;
      expect(data.domain).toBe('app.example.com');
      expect(prisma.environment.findFirst).toHaveBeenCalledWith({
        where: { id: { not: envId }, domain: 'app.example.com', project: { workspaceId } },
        select: { id: true },
      });
    });

    it('writes the normalised null when domain is an empty string (and skips conflict query)', async () => {
      await service.update(envId, { domain: '' }, workspaceId);

      const data = (prisma.environment.update as vi.Mock).mock.calls[0][0].data;
      expect(data.domain).toBeNull();
      expect(prisma.environment.findFirst).not.toHaveBeenCalled();
    });

    it('writes null and skips conflict query when domain is all whitespace', async () => {
      await service.update(envId, { domain: '     ' }, workspaceId);

      const data = (prisma.environment.update as vi.Mock).mock.calls[0][0].data;
      expect(data.domain).toBeNull();
      expect(prisma.environment.findFirst).not.toHaveBeenCalled();
    });

    it('does not run conflict query when domain is undefined or null', async () => {
      await service.update(envId, { domain: undefined as any }, workspaceId);
      await service.update(envId, { domain: null as any }, workspaceId);

      expect(prisma.environment.findFirst).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when the same domain already exists in the workspace', async () => {
      prisma.environment.findFirst.mockResolvedValue({ id: 'env-other' });

      await expect(service.update(envId, { domain: 'taken.example.com' }, workspaceId)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.environment.update).not.toHaveBeenCalled();
    });

    it.each([
      ['with protocol', 'https://app.example.com'],
      ['with path', 'app.example.com/health'],
      ['single label without dot', 'localhost'],
      ['illegal character', 'app_example.com'],
    ])('rejects an invalid domain (%s) and does not call update', async (_label, bad) => {
      await expect(service.update(envId, { domain: bad }, workspaceId)).rejects.toThrow(ForbiddenException);
      expect(prisma.environment.update).not.toHaveBeenCalled();
    });
  });

  describe('update - deploy-related fields', () => {
    beforeEach(() => {
      prisma.environment.findUnique.mockResolvedValue(envRecord);
      prisma.project.findUnique.mockResolvedValue(projectInWorkspace);
      prisma.environment.update.mockResolvedValue({ id: envId });
      prisma.environment.findFirst.mockResolvedValue(null);
      prisma.deployTarget.findUnique.mockResolvedValue({ projectId });
    });

    it('writes externalPort=0 (the guard is != null, so 0 is treated as present)', async () => {
      await service.update(envId, { externalPort: 0 }, workspaceId);

      const data = (prisma.environment.update as vi.Mock).mock.calls[0][0].data;
      expect(data.externalPort).toBe(0);
    });

    it('writes enabled=false / autoDeploy=false / requireCi=false explicitly', async () => {
      await service.update(envId, { enabled: false, autoDeploy: false, requireCi: false }, workspaceId);

      const data = (prisma.environment.update as vi.Mock).mock.calls[0][0].data;
      expect(data.enabled).toBe(false);
      expect(data.autoDeploy).toBe(false);
      expect(data.requireCi).toBe(false);
    });

    it('writes deployTargetId for a non-empty value', async () => {
      await service.update(envId, { deployTargetId: 'target-1' }, workspaceId);

      const data = (prisma.environment.update as vi.Mock).mock.calls[0][0].data;
      expect(data.deployTargetId).toBe('target-1');
    });

    it('normalizes deployTargetId="" to null to detach the target', async () => {
      await service.update(envId, { deployTargetId: '' }, workspaceId);

      const data = (prisma.environment.update as vi.Mock).mock.calls[0][0].data;
      expect(data.deployTargetId).toBeNull();
    });

    it('skips deployTargetId when it is null (per the != null guard)', async () => {
      await service.update(envId, { deployTargetId: null as any }, workspaceId);

      const data = (prisma.environment.update as vi.Mock).mock.calls[0][0].data;
      expect('deployTargetId' in data).toBe(false);
    });

    it('skips deployTargetId when it is undefined', async () => {
      await service.update(envId, { deployTargetId: undefined as any }, workspaceId);

      const data = (prisma.environment.update as vi.Mock).mock.calls[0][0].data;
      expect('deployTargetId' in data).toBe(false);
    });
  });
});
