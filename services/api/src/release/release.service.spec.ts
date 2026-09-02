import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ReleaseService } from './release.service';
import { GateCheckService } from './gate-check.service';
import { createPrismaMock, MockPrismaService } from '../../test/helpers/prisma-mock';

const FIXED_PUBLISH_TIME = new Date('2026-08-13T06:00:00.000Z');

describe('ReleaseService', () => {
  let service: ReleaseService;
  let prisma: MockPrismaService;
  let gateCheck: { checkGates: jest.Mock };

  const projectId = 'proj-1';
  const userId = 'user-1';
  const releaseId = 'rel-1';

  const baseRelease = {
    id: releaseId,
    projectId,
    environmentId: 'env-1',
    deploymentId: 'deploy-1',
    version: '1.0.0',
    notes: 'initial notes',
    status: 'DRAFT',
    gateStatus: null,
    releasedBy: null,
    releasedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  beforeEach(() => {
    prisma = createPrismaMock();
    gateCheck = { checkGates: jest.fn() };
    service = new ReleaseService(prisma as any, gateCheck as unknown as GateCheckService);
  });

  describe('createRelease', () => {
    it('persists the exact DTO fields plus releasedBy=userId', async () => {
      prisma.environment.findUnique.mockResolvedValue({ projectId });
      prisma.deployment.findUnique.mockResolvedValue({
        projectId,
        environmentId: 'env-1',
        status: 'SUCCEEDED',
        artifactId: 'artifact-1',
      });
      const created = { ...baseRelease, id: 'rel-new' };
      prisma.release.create.mockResolvedValue(created);

      const result = await service.createRelease(
        projectId,
        { environmentId: 'env-1', deploymentId: 'deploy-1', version: '1.0.0', notes: 'ship it' },
        userId,
      );

      expect(prisma.release.create).toHaveBeenCalledWith({
        data: {
          projectId,
          environmentId: 'env-1',
          deploymentId: 'deploy-1',
          version: '1.0.0',
          notes: 'ship it',
          releasedBy: userId,
        },
      });
      expect(result).toBe(created);
    });

    it('persists notes as null when not provided', async () => {
      prisma.environment.findUnique.mockResolvedValue({ projectId });
      prisma.deployment.findUnique.mockResolvedValue({
        projectId,
        environmentId: 'env-1',
        status: 'SUCCEEDED',
        artifactId: 'artifact-1',
      });
      const created = { ...baseRelease, id: 'rel-new', notes: null };
      prisma.release.create.mockResolvedValue(created);

      const result = await service.createRelease(
        projectId,
        { environmentId: 'env-1', deploymentId: 'deploy-1', version: '1.0.0' /* notes omitted */ },
        userId,
      );

      expect(prisma.release.create).toHaveBeenCalledWith({
        data: {
          projectId,
          environmentId: 'env-1',
          deploymentId: 'deploy-1',
          version: '1.0.0',
          notes: null,
          releasedBy: userId,
        },
      });
      expect(result).toBe(created);
    });

    it('rejects when environmentId does not belong to the URL projectId', async () => {
      prisma.environment.findUnique.mockResolvedValue({ projectId: 'other-project' });
      prisma.deployment.findUnique.mockResolvedValue({ projectId });

      await expect(
        service.createRelease(
          projectId,
          { environmentId: 'env-x', deploymentId: 'deploy-1', version: '1.0.0' },
          userId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when deploymentId does not belong to the URL projectId', async () => {
      prisma.environment.findUnique.mockResolvedValue({ projectId });
      prisma.deployment.findUnique.mockResolvedValue({ projectId: 'other-project' });

      await expect(
        service.createRelease(
          projectId,
          { environmentId: 'env-1', deploymentId: 'deploy-x', version: '1.0.0' },
          userId,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('listReleases', () => {
    it('queries by projectId only and orders by createdAt desc', async () => {
      const rows = [{ id: 'r1' }, { id: 'r2' }];
      prisma.release.findMany.mockResolvedValue(rows);

      const result = await service.listReleases(projectId);

      expect(prisma.release.findMany).toHaveBeenCalledWith({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toBe(rows);
    });
  });

  describe('getRelease', () => {
    it('returns the release when found', async () => {
      prisma.release.findUnique.mockResolvedValue(baseRelease);
      const result = await service.getRelease(releaseId);
      expect(prisma.release.findUnique).toHaveBeenCalledWith({ where: { id: releaseId } });
      expect(result).toBe(baseRelease);
    });

    it('throws NotFoundException with the exact "发布不存在" message when missing', async () => {
      prisma.release.findUnique.mockResolvedValue(null);

      const rejection = service.getRelease(releaseId);
      await expect(rejection).rejects.toThrow(NotFoundException);
      await expect(rejection).rejects.toThrow('发布不存在');
    });
  });

  describe('getGateStatus', () => {
    it('returns the GateCheckService result for the given release id', async () => {
      const gateResult = { gates: [{ name: 'x', passed: true, message: 'ok' }], allPassed: true };
      gateCheck.checkGates.mockResolvedValue(gateResult);

      const result = await service.getGateStatus(releaseId);

      expect(gateCheck.checkGates).toHaveBeenCalledWith(releaseId);
      expect(result).toBe(gateResult);
    });
  });

  describe('publish', () => {
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(FIXED_PUBLISH_TIME);
      prisma.release.findUnique.mockResolvedValue(baseRelease);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('throws NotFoundException without consulting GateCheckService or exemptions or update', async () => {
      prisma.release.findUnique.mockResolvedValue(null);

      const rejection = service.publish(releaseId, userId);
      await expect(rejection).rejects.toThrow(NotFoundException);
      await expect(rejection).rejects.toThrow('发布不存在');
      expect(gateCheck.checkGates).not.toHaveBeenCalled();
      expect(prisma.gateExemption.findMany).not.toHaveBeenCalled();
      expect(prisma.release.update).not.toHaveBeenCalled();
    });

    it('publishes when all gates pass: status=PUBLISHED, gateStatus=PASSED, releasedBy=userId, releasedAt=fixed time', async () => {
      gateCheck.checkGates.mockResolvedValue({
        gates: [
          { name: 'staging_deploy', passed: true, message: 'ok' },
          { name: 'health_check', passed: true, message: 'ok' },
          { name: 'p0_tests', passed: true, message: 'ok' },
          { name: 'open_issues', passed: true, message: 'ok' },
        ],
        allPassed: true,
      });
      prisma.gateExemption.findMany.mockResolvedValue([]);
      prisma.release.update.mockResolvedValue({ ...baseRelease, status: 'PUBLISHED' });

      const result = await service.publish(releaseId, userId);

      expect(prisma.release.update).toHaveBeenCalledWith({
        where: { id: releaseId },
        data: {
          status: 'PUBLISHED',
          gateStatus: 'PASSED',
          releasedBy: userId,
          releasedAt: FIXED_PUBLISH_TIME,
        },
      });
      expect(prisma.gateExemption.findMany).toHaveBeenCalledWith({ where: { releaseId } });
      expect(result.status).toBe('PUBLISHED');
    });

    it('blocks publish with ForbiddenException when one gate fails and no exemption exists', async () => {
      gateCheck.checkGates.mockResolvedValue({
        gates: [
          { name: 'staging_deploy', passed: true, message: 'ok' },
          { name: 'health_check', passed: false, message: 'health check failed' },
          { name: 'p0_tests', passed: true, message: 'ok' },
          { name: 'open_issues', passed: true, message: 'ok' },
        ],
        allPassed: false,
      });
      prisma.gateExemption.findMany.mockResolvedValue([]);

      const rejection = service.publish(releaseId, userId);
      await expect(rejection).rejects.toThrow(ForbiddenException);
      await expect(rejection).rejects.toMatchObject({ message: 'Gate 未通过: health check failed' });
      expect(prisma.release.update).not.toHaveBeenCalled();
    });

    it('concatenates failing messages in gate order when multiple gates fail and none are exempt', async () => {
      gateCheck.checkGates.mockResolvedValue({
        gates: [
          { name: 'staging_deploy', passed: true, message: 'preflight ok' },
          { name: 'health_check', passed: false, message: 'health check failed' },
          { name: 'p0_tests', passed: false, message: 'p0 test failed' },
          { name: 'open_issues', passed: true, message: 'no issues' },
        ],
        allPassed: false,
      });
      prisma.gateExemption.findMany.mockResolvedValue([]);

      await expect(service.publish(releaseId, userId)).rejects.toMatchObject({
        message: 'Gate 未通过: health check failed; p0 test failed',
      });
      expect(prisma.release.update).not.toHaveBeenCalled();
    });

    it('publishes as EXEMPTED when every failing gate has a matching exemption', async () => {
      gateCheck.checkGates.mockResolvedValue({
        gates: [
          { name: 'staging_deploy', passed: true, message: 'ok' },
          { name: 'health_check', passed: false, message: 'h' },
          { name: 'p0_tests', passed: false, message: 'p' },
          { name: 'open_issues', passed: true, message: 'ok' },
        ],
        allPassed: false,
      });
      prisma.gateExemption.findMany.mockResolvedValue([{ gateName: 'health_check' }, { gateName: 'p0_tests' }]);
      prisma.release.update.mockResolvedValue({ ...baseRelease, status: 'PUBLISHED' });

      await service.publish(releaseId, userId);

      expect(prisma.release.update).toHaveBeenCalledWith({
        where: { id: releaseId },
        data: {
          status: 'PUBLISHED',
          gateStatus: 'EXEMPTED',
          releasedBy: userId,
          releasedAt: FIXED_PUBLISH_TIME,
        },
      });
    });

    it('still blocks when only some failing gates are exempt (error only lists unexempt gates)', async () => {
      gateCheck.checkGates.mockResolvedValue({
        gates: [
          { name: 'health_check', passed: false, message: 'h' },
          { name: 'p0_tests', passed: false, message: 'p' },
        ],
        allPassed: false,
      });
      // Only health_check is exempt
      prisma.gateExemption.findMany.mockResolvedValue([{ gateName: 'health_check' }]);

      const rejection = service.publish(releaseId, userId);
      await expect(rejection).rejects.toThrow(ForbiddenException);
      await expect(rejection).rejects.toMatchObject({ message: 'Gate 未通过: p' });
      expect(prisma.release.update).not.toHaveBeenCalled();
    });

    it('exemptions for unrelated gate names do not bypass failing gates', async () => {
      gateCheck.checkGates.mockResolvedValue({
        gates: [
          { name: 'health_check', passed: false, message: 'h' },
          { name: 'p0_tests', passed: false, message: 'p' },
        ],
        allPassed: false,
      });
      prisma.gateExemption.findMany.mockResolvedValue([{ gateName: 'staging_deploy' }]);

      await expect(service.publish(releaseId, userId)).rejects.toThrow(ForbiddenException);
      expect(prisma.release.update).not.toHaveBeenCalled();
    });

    it('duplicate exemption records do not change Set-based deduplication', async () => {
      gateCheck.checkGates.mockResolvedValue({
        gates: [
          { name: 'health_check', passed: false, message: 'h' },
          { name: 'p0_tests', passed: false, message: 'p' },
        ],
        allPassed: false,
      });
      prisma.gateExemption.findMany.mockResolvedValue([
        { gateName: 'health_check' },
        { gateName: 'health_check' }, // duplicate
        { gateName: 'p0_tests' },
      ]);
      prisma.release.update.mockResolvedValue({ ...baseRelease, status: 'PUBLISHED' });

      await service.publish(releaseId, userId);

      expect(prisma.release.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PUBLISHED', gateStatus: 'EXEMPTED' }),
        }),
      );
    });

    it('fails closed when Gate evaluation returns no evidence', async () => {
      gateCheck.checkGates.mockResolvedValue({ gates: [], allPassed: false });
      prisma.gateExemption.findMany.mockResolvedValue([]);

      await expect(service.publish(releaseId, userId)).rejects.toThrow(ForbiddenException);
      expect(prisma.gateExemption.findMany).not.toHaveBeenCalled();
      expect(prisma.release.update).not.toHaveBeenCalled();
    });
  });

  describe('exemptGate', () => {
    it('persists releaseId, gateName, exemptedBy=userId, reason=string', async () => {
      prisma.gateExemption.create.mockResolvedValue({ id: 'ex-1' });

      const result = await service.exemptGate(releaseId, 'health_check', { reason: 'ops override' }, userId);

      expect(prisma.gateExemption.create).toHaveBeenCalledWith({
        data: {
          releaseId,
          gateName: 'health_check',
          exemptedBy: userId,
          reason: 'ops override',
          ticket: null,
        },
      });
      expect(result).toEqual({ id: 'ex-1' });
    });

    it('rejects exemptGate without a reason (KI-020)', async () => {
      await expect(service.exemptGate(releaseId, 'health_check', {} as any, userId)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.gateExemption.create).not.toHaveBeenCalled();
    });

    it('records the reason and ticket in the workspace audit log', async () => {
      const audit = { record: jest.fn().mockResolvedValue({ id: 'audit-1' }) };
      const auditedService = new ReleaseService(prisma as any, gateCheck as unknown as GateCheckService, audit as any);
      prisma.gateExemption.create.mockResolvedValue({ id: 'ex-1' });
      prisma.release.findUnique.mockResolvedValue({ project: { workspaceId: 'ws-1' } } as any);

      await auditedService.exemptGate(
        releaseId,
        'health_check',
        { reason: 'incident mitigation', ticket: 'OPS-42' },
        userId,
      );

      expect(prisma.gateExemption.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ ticket: 'OPS-42' }),
      });
      expect(audit.record).toHaveBeenCalledWith(userId, 'ws-1', 'RELEASE_GATE_EXEMPTED', 'RELEASE', releaseId, {
        gateName: 'health_check',
        reason: 'incident mitigation',
        ticket: 'OPS-42',
      });
    });
  });

  describe('getExemptions', () => {
    it('queries by releaseId only and returns Prisma result', async () => {
      const rows = [{ id: 'ex-1' }, { id: 'ex-2' }];
      prisma.gateExemption.findMany.mockResolvedValue(rows);

      const result = await service.getExemptions(releaseId);

      expect(prisma.gateExemption.findMany).toHaveBeenCalledWith({ where: { releaseId } });
      expect(result).toBe(rows);
    });
  });
});
