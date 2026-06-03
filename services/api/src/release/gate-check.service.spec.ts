import { GateCheckService } from './gate-check.service';
import { createPrismaMock, MockPrismaService } from '../../test/helpers/prisma-mock';

describe('GateCheckService.checkGates', () => {
  let service: GateCheckService;
  let prisma: MockPrismaService;

  const release = {
    id: 'rel-1',
    projectId: 'proj-1',
    environmentId: 'env-1',
    deploymentId: 'deploy-1',
  };

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new GateCheckService(prisma as any);

    prisma.release.findUnique.mockResolvedValue(release);
    prisma.environment.findUnique.mockResolvedValue({ id: 'env-1', type: 'STAGING' });
    prisma.deployment.findUnique.mockResolvedValue({ id: 'deploy-1', status: 'SUCCEEDED' });
    prisma.testRun.findMany.mockResolvedValue([]);
    prisma.issue.count.mockResolvedValue(0);
  });

  it('should return empty gates if release not found', async () => {
    prisma.release.findUnique.mockResolvedValue(null);
    const result = await service.checkGates('nonexistent');
    expect(result.gates).toEqual([]);
    expect(result.allPassed).toBe(false);
  });

  it('should pass staging_deploy gate when environment type is STAGING', async () => {
    const result = await service.checkGates('rel-1');
    const gate = result.gates.find(g => g.name === 'staging_deploy');
    expect(gate?.passed).toBe(true);
  });

  it('should pass health_check gate when deployment status is SUCCEEDED', async () => {
    const result = await service.checkGates('rel-1');
    const gate = result.gates.find(g => g.name === 'health_check');
    expect(gate?.passed).toBe(true);
  });

  it('should fail p0_tests gate when a test run has failed cases', async () => {
    prisma.testRun.findMany.mockResolvedValue([{ id: 'tr-1', failedCases: 2 }]);
    const result = await service.checkGates('rel-1');
    const gate = result.gates.find(g => g.name === 'p0_tests');
    expect(gate?.passed).toBe(false);
  });

  it('should fail open_issues gate when there are open P0/P1 issues', async () => {
    prisma.issue.count.mockResolvedValue(3);
    const result = await service.checkGates('rel-1');
    const gate = result.gates.find(g => g.name === 'open_issues');
    expect(gate?.passed).toBe(false);
  });

  it('should set allPassed to true only when every gate passes', async () => {
    const result = await service.checkGates('rel-1');
    expect(result.allPassed).toBe(true);
    expect(result.gates.every(g => g.passed)).toBe(true);
  });
});
