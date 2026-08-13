import { NotFoundException } from '@nestjs/common';
import { TestService } from './test.service';
import { createPrismaMock, MockPrismaService } from '../../test/helpers/prisma-mock';

const FIXED_TIME = new Date('2026-08-13T06:00:00.000Z');

describe('TestService', () => {
  let service: TestService;
  let prisma: MockPrismaService;

  const projectId = 'proj-1';
  const environmentId = 'env-1';
  const deploymentId = 'deploy-1';
  const testCaseId = 'tc-1';
  const testRunId = 'run-1';
  const runCaseId = 'rc-1';
  const userId = 'user-1';

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new TestService(prisma as any);
  });

  describe('createTestCase', () => {
    it('persists the exact DTO fields and defaults priority to P2 when undefined', async () => {
      prisma.testCase.create.mockResolvedValue({ id: testCaseId, priority: 'P2' });

      const result = await service.createTestCase(projectId, {
        title: 't1',
        description: 'd1',
        steps: 's1',
        expectedResult: 'er1',
      });

      expect(prisma.testCase.create).toHaveBeenCalledWith({
        data: {
          projectId,
          title: 't1',
          description: 'd1',
          priority: 'P2',
          steps: 's1',
          expectedResult: 'er1',
        },
      });
      expect(result.priority).toBe('P2');
    });

    it('persists priority="P0" / "P1" / "P3" exactly as provided', async () => {
      prisma.testCase.create.mockResolvedValue({ id: testCaseId });

      await service.createTestCase(projectId, { title: 't', priority: 'P0' });
      expect((prisma.testCase.create as jest.Mock).mock.calls[0][0].data.priority).toBe('P0');

      await service.createTestCase(projectId, { title: 't', priority: 'P1' });
      expect((prisma.testCase.create as jest.Mock).mock.calls[1][0].data.priority).toBe('P1');

      await service.createTestCase(projectId, { title: 't', priority: 'P3' });
      expect((prisma.testCase.create as jest.Mock).mock.calls[2][0].data.priority).toBe('P3');
    });

    it('current behaviour: priority=null or priority="" both fall through to P2 via `|| "P2"`', async () => {
      prisma.testCase.create.mockResolvedValue({ id: testCaseId });

      await service.createTestCase(projectId, { title: 't1', priority: null as any });
      expect((prisma.testCase.create as jest.Mock).mock.calls[0][0].data.priority).toBe('P2');

      await service.createTestCase(projectId, { title: 't2', priority: '' });
      expect((prisma.testCase.create as jest.Mock).mock.calls[1][0].data.priority).toBe('P2');
    });
  });

  describe('listTestCases', () => {
    it('queries by projectId and orders by createdAt desc', async () => {
      const rows = [{ id: 't1' }];
      prisma.testCase.findMany.mockResolvedValue(rows);

      const result = await service.listTestCases(projectId);

      expect(prisma.testCase.findMany).toHaveBeenCalledWith({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toBe(rows);
    });
  });

  describe('getTestCase', () => {
    it('returns the test case when found', async () => {
      prisma.testCase.findUnique.mockResolvedValue({ id: testCaseId, title: 't' });
      const result = await service.getTestCase(testCaseId);
      expect(result).toEqual({ id: testCaseId, title: 't' });
    });

    it('throws NotFoundException with the exact "Test case not found" message when missing', async () => {
      prisma.testCase.findUnique.mockResolvedValue(null);
      await expect(service.getTestCase(testCaseId)).rejects.toThrow(NotFoundException);
      await expect(service.getTestCase(testCaseId)).rejects.toThrow('Test case not found');
    });
  });

  describe('updateTestCase', () => {
    it('writes all allowed fields exactly when provided', async () => {
      const updated = { id: testCaseId, title: 'new' };
      prisma.testCase.update.mockResolvedValue(updated);

      const result = await service.updateTestCase(testCaseId, {
        title: 'new',
        description: 'd',
        priority: 'P1',
        steps: 's',
        expectedResult: 'er',
        status: 'INACTIVE',
      });

      expect(prisma.testCase.update).toHaveBeenCalledWith({
        where: { id: testCaseId },
        data: {
          title: 'new',
          description: 'd',
          priority: 'P1',
          steps: 's',
          expectedResult: 'er',
          status: 'INACTIVE',
        },
      });
      expect(result).toBe(updated);
    });

    it('omits undefined fields from the data payload', async () => {
      prisma.testCase.update.mockResolvedValue({ id: testCaseId });

      await service.updateTestCase(testCaseId, { title: 'only' });

      const data = (prisma.testCase.update as jest.Mock).mock.calls[0][0].data;
      expect(data).toEqual({ title: 'only' });
      expect('description' in data).toBe(false);
      expect('priority' in data).toBe(false);
      expect('steps' in data).toBe(false);
      expect('expectedResult' in data).toBe(false);
      expect('status' in data).toBe(false);
    });

    it('current behaviour: null and empty string are forwarded (only undefined is skipped)', async () => {
      prisma.testCase.update.mockResolvedValue({ id: testCaseId });

      await service.updateTestCase(testCaseId, {
        title: null as any,
        description: '',
        priority: null as any,
      });

      const data = (prisma.testCase.update as jest.Mock).mock.calls[0][0].data;
      expect(data.title).toBeNull();
      expect(data.description).toBe('');
      expect(data.priority).toBeNull();
    });

    it('sends an empty data object when every field is undefined', async () => {
      prisma.testCase.update.mockResolvedValue({ id: testCaseId });

      await service.updateTestCase(testCaseId, {});

      expect(prisma.testCase.update).toHaveBeenCalledWith({
        where: { id: testCaseId },
        data: {},
      });
    });

    it('does not leak disallowed keys (projectId, id) into the data payload', async () => {
      prisma.testCase.update.mockResolvedValue({ id: testCaseId });

      await service.updateTestCase(testCaseId, { title: 't', projectId: 'INJECTED', id: 'INJECTED' } as any);

      const data = (prisma.testCase.update as jest.Mock).mock.calls[0][0].data;
      expect('projectId' in data).toBe(false);
      expect('id' in data).toBe(false);
    });
  });

  describe('deleteTestCase', () => {
    it('deletes by id and returns undefined', async () => {
      prisma.testCase.delete.mockResolvedValue({ id: testCaseId });
      const result = await service.deleteTestCase(testCaseId);
      expect(prisma.testCase.delete).toHaveBeenCalledWith({ where: { id: testCaseId } });
      expect(result).toBeUndefined();
    });

    it('propagates Prisma errors unchanged (no fabricated Service-layer NotFoundException)', async () => {
      const prismaError = new Error('Row not found');
      prisma.testCase.delete.mockRejectedValue(prismaError);
      await expect(service.deleteTestCase(testCaseId)).rejects.toBe(prismaError);
    });
  });

  describe('createTestRun', () => {
    it('queries ACTIVE test cases for the project and creates a TestRun + TestRunCase rows in one transaction', async () => {
      const cases = [{ id: 'tc-a' }, { id: 'tc-b' }];
      const run = { id: testRunId, totalCases: 2 };
      const tx = {
        testRun: { create: jest.fn().mockResolvedValue(run) },
        testRunCase: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
      };
      prisma.testCase.findMany.mockResolvedValue(cases);
      prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));

      const result = await service.createTestRun(deploymentId, projectId, environmentId, userId);

      // Query is exactly { projectId, status: 'ACTIVE' }
      expect(prisma.testCase.findMany).toHaveBeenCalledWith({ where: { projectId, status: 'ACTIVE' } });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.testRun.create).toHaveBeenCalledWith({
        data: {
          deploymentId,
          projectId,
          environmentId,
          totalCases: 2,
          triggeredBy: userId,
        },
      });

      // createMany data is exactly the { testRunId, testCaseId } rows
      expect(tx.testRunCase.createMany).toHaveBeenCalledWith({
        data: [
          { testRunId, testCaseId: 'tc-a' },
          { testRunId, testCaseId: 'tc-b' },
        ],
      });

      // The Run is what the inner create returns — it is the return of the transaction
      expect(result).toBe(run);
    });

    it('when zero ACTIVE cases: still creates the Run, totalCases=0, no createMany call', async () => {
      const run = { id: testRunId, totalCases: 0, status: 'PENDING', finishedAt: null };
      const tx = {
        testRun: { create: jest.fn().mockResolvedValue(run) },
        testRunCase: { createMany: jest.fn() },
      };
      prisma.testCase.findMany.mockResolvedValue([]);
      prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));

      const result = await service.createTestRun(deploymentId, projectId, environmentId, userId);

      expect(tx.testRun.create).toHaveBeenCalledWith({
        data: {
          deploymentId,
          projectId,
          environmentId,
          totalCases: 0,
          triggeredBy: userId,
        },
      });
      const createData = tx.testRun.create.mock.calls[0][0].data;
      expect('status' in createData).toBe(false);
      expect('finishedAt' in createData).toBe(false);
      expect(tx.testRunCase.createMany).not.toHaveBeenCalled();
      expect(result).toBe(run);
    });
  });

  describe('getTestRun', () => {
    it('returns the run when found', async () => {
      prisma.testRun.findUnique.mockResolvedValue({ id: testRunId });
      const result = await service.getTestRun(testRunId);
      expect(result).toEqual({ id: testRunId });
    });

    it('throws NotFoundException with the exact "Test run not found" message when missing', async () => {
      prisma.testRun.findUnique.mockResolvedValue(null);
      await expect(service.getTestRun(testRunId)).rejects.toThrow(NotFoundException);
      await expect(service.getTestRun(testRunId)).rejects.toThrow('Test run not found');
    });
  });

  describe('listTestRuns', () => {
    it('queries by projectId and orders by createdAt desc', async () => {
      const rows = [{ id: 'r1' }];
      prisma.testRun.findMany.mockResolvedValue(rows);
      const result = await service.listTestRuns(projectId);
      expect(prisma.testRun.findMany).toHaveBeenCalledWith({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toBe(rows);
    });
  });

  describe('getTestRunCases', () => {
    it('queries by testRunId and includes the related testCase', async () => {
      prisma.testRunCase.findMany.mockResolvedValue([{ id: runCaseId, testCase: { id: testCaseId } }]);

      const result = await service.getTestRunCases(testRunId);

      expect(prisma.testRunCase.findMany).toHaveBeenCalledWith({
        where: { testRunId },
        include: { testCase: true },
      });
      expect(result).toEqual([{ id: runCaseId, testCase: { id: testCaseId } }]);
    });
  });

  describe('updateTestRunCase identity check', () => {
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(FIXED_TIME);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('findFirst uses both caseId and testRunId', async () => {
      prisma.testRunCase.findFirst.mockResolvedValue({ id: runCaseId, testRunId });
      prisma.testRunCase.update.mockResolvedValue({ id: runCaseId });
      prisma.testRunCase.findMany.mockResolvedValue([{ id: runCaseId, result: 'PASSED' }]);
      prisma.testRun.update.mockResolvedValue({ id: testRunId });

      await service.updateTestRunCase(testRunId, runCaseId, { result: 'PASSED' }, userId);

      expect(prisma.testRunCase.findFirst).toHaveBeenCalledWith({
        where: { id: runCaseId, testRunId },
      });
    });

    it('throws NotFoundException with the exact "Test run case not found" message when the case does not belong to the run', async () => {
      prisma.testRunCase.findFirst.mockResolvedValue(null);

      const rejection = service.updateTestRunCase(testRunId, 'rc-MISSING', { result: 'PASSED' }, userId);
      await expect(rejection).rejects.toThrow(NotFoundException);
      await expect(rejection).rejects.toThrow('Test run case not found');

      expect(prisma.testRunCase.update).not.toHaveBeenCalled();
      expect(prisma.testRun.findMany).not.toHaveBeenCalled();
      expect(prisma.testRun.update).not.toHaveBeenCalled();
    });

    it('updates the case with result, notes, executedBy=userId, executedAt=fixed time; then refreshes counters', async () => {
      prisma.testRunCase.findFirst.mockResolvedValue({ id: runCaseId, testRunId });
      prisma.testRunCase.update.mockResolvedValue({ id: runCaseId, result: 'PASSED' });
      prisma.testRunCase.findMany.mockResolvedValue([{ id: runCaseId, result: 'PASSED' }]);
      prisma.testRun.update.mockResolvedValue({ id: testRunId });

      const result = await service.updateTestRunCase(testRunId, runCaseId, { result: 'PASSED', notes: 'n1' }, userId);

      expect(prisma.testRunCase.update).toHaveBeenCalledWith({
        where: { id: runCaseId },
        data: {
          result: 'PASSED',
          notes: 'n1',
          executedBy: userId,
          executedAt: FIXED_TIME,
        },
      });
      // Counters were updated (private method reached via the public update)
      expect(prisma.testRunCase.findMany).toHaveBeenCalledWith({ where: { testRunId } });
      expect(prisma.testRun.update).toHaveBeenCalled();
      expect(prisma.testRunCase.update.mock.invocationCallOrder[0])
        .toBeLessThan(prisma.testRunCase.findMany.mock.invocationCallOrder[0]);
      expect(prisma.testRunCase.findMany.mock.invocationCallOrder[0])
        .toBeLessThan(prisma.testRun.update.mock.invocationCallOrder[0]);
      expect(result.id).toBe(runCaseId);
    });
  });

  describe('counters and status (reached via updateTestRunCase)', () => {
    let capturedRunUpdate: any;

    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(FIXED_TIME);
      // Default: the case is found and updated successfully
      prisma.testRunCase.findFirst.mockResolvedValue({ id: runCaseId, testRunId });
      prisma.testRunCase.update.mockResolvedValue({ id: runCaseId });
      // The default list of cases for counter computation is set per-test
      prisma.testRun.update.mockImplementation(({ data }: any) => {
        capturedRunUpdate = data;
        return Promise.resolve({ id: testRunId });
      });
    });

    afterEach(() => {
      try {
        expect(prisma.testRun.update).toHaveBeenCalledWith(expect.objectContaining({
          where: { id: testRunId },
        }));
      } finally {
        jest.useRealTimers();
        capturedRunUpdate = undefined;
      }
    });

    it('all cases PASSED: passedCases=count, status=COMPLETED, finishedAt=fixed', async () => {
      prisma.testRunCase.findMany.mockResolvedValue([
        { id: 'rc-1', result: 'PASSED' },
        { id: 'rc-2', result: 'PASSED' },
        { id: 'rc-3', result: 'PASSED' },
      ]);

      await service.updateTestRunCase(testRunId, runCaseId, { result: 'PASSED' }, userId);

      expect(capturedRunUpdate.passedCases).toBe(3);
      expect(capturedRunUpdate.failedCases).toBe(0);
      expect(capturedRunUpdate.skippedCases).toBe(0);
      expect(capturedRunUpdate.status).toBe('COMPLETED');
      expect(capturedRunUpdate.finishedAt.getTime()).toBe(FIXED_TIME.getTime());
    });

    it('all cases FAILED: failedCases=count, status=COMPLETED, finishedAt=fixed', async () => {
      prisma.testRunCase.findMany.mockResolvedValue([
        { id: 'rc-1', result: 'FAILED' },
        { id: 'rc-2', result: 'FAILED' },
      ]);

      await service.updateTestRunCase(testRunId, runCaseId, { result: 'FAILED' }, userId);

      expect(capturedRunUpdate.passedCases).toBe(0);
      expect(capturedRunUpdate.failedCases).toBe(2);
      expect(capturedRunUpdate.skippedCases).toBe(0);
      expect(capturedRunUpdate.status).toBe('COMPLETED');
      expect(capturedRunUpdate.finishedAt.getTime()).toBe(FIXED_TIME.getTime());
    });

    it('all cases SKIPPED: skippedCases=count, status=COMPLETED, finishedAt=fixed', async () => {
      prisma.testRunCase.findMany.mockResolvedValue([
        { id: 'rc-1', result: 'SKIPPED' },
        { id: 'rc-2', result: 'SKIPPED' },
        { id: 'rc-3', result: 'SKIPPED' },
      ]);

      await service.updateTestRunCase(testRunId, runCaseId, { result: 'SKIPPED' }, userId);

      expect(capturedRunUpdate.passedCases).toBe(0);
      expect(capturedRunUpdate.failedCases).toBe(0);
      expect(capturedRunUpdate.skippedCases).toBe(3);
      expect(capturedRunUpdate.status).toBe('COMPLETED');
      expect(capturedRunUpdate.finishedAt.getTime()).toBe(FIXED_TIME.getTime());
    });

    it('PENDING does not count toward passed/failed/skipped; a single PENDING keeps status=RUNNING, finishedAt=null', async () => {
      prisma.testRunCase.findMany.mockResolvedValue([
        { id: 'rc-1', result: 'PASSED' },
        { id: 'rc-2', result: 'PENDING' },
      ]);

      await service.updateTestRunCase(testRunId, runCaseId, { result: 'PASSED' }, userId);

      expect(capturedRunUpdate).toEqual({
        passedCases: 1,
        failedCases: 0,
        skippedCases: 0,
        status: 'RUNNING',
        finishedAt: null,
      });
    });

    it('mixed scenario: counts each category and sets status=COMPLETED, finishedAt=fixed', async () => {
      prisma.testRunCase.findMany.mockResolvedValue([
        { id: 'rc-1', result: 'PASSED' },
        { id: 'rc-2', result: 'FAILED' },
        { id: 'rc-3', result: 'SKIPPED' },
        { id: 'rc-4', result: 'PASSED' },
      ]);

      await service.updateTestRunCase(testRunId, runCaseId, { result: 'FAILED' }, userId);

      expect(capturedRunUpdate.passedCases).toBe(2);
      expect(capturedRunUpdate.failedCases).toBe(1);
      expect(capturedRunUpdate.skippedCases).toBe(1);
      expect(capturedRunUpdate.status).toBe('COMPLETED');
      expect(capturedRunUpdate.finishedAt.getTime()).toBe(FIXED_TIME.getTime());
    });

    it('only one case in PENDING: status=RUNNING, finishedAt=null', async () => {
      prisma.testRunCase.findMany.mockResolvedValue([
        { id: 'rc-1', result: 'PENDING' },
      ]);

      await service.updateTestRunCase(testRunId, runCaseId, { result: 'PENDING' }, userId);

      expect(capturedRunUpdate).toEqual({
        passedCases: 0,
        failedCases: 0,
        skippedCases: 0,
        status: 'RUNNING',
        finishedAt: null,
      });
    });

    it('empty case list (every([])): writes status=COMPLETED, counters 0/0/0, finishedAt=fixed — candidate inconsistency with 0-case createTestRun', async () => {
      // Documenting CURRENT production behaviour:
      //   updateTestRunCounters([].filter, [].every) → passed=0, failed=0, skipped=0, allDone=true
      //   → write status='COMPLETED', finishedAt=new Date()
      // In contrast, createTestRun(0 cases) leaves a Run at Prisma's PENDING default.
      // This is a candidate production defect: empty TestRun is treated as "completed"
      // through the update path but "in-progress" through the create path. Reporting only.
      prisma.testRunCase.findMany.mockResolvedValue([]);

      await service.updateTestRunCase(testRunId, runCaseId, { result: 'PASSED' }, userId);

      expect(capturedRunUpdate.passedCases).toBe(0);
      expect(capturedRunUpdate.failedCases).toBe(0);
      expect(capturedRunUpdate.skippedCases).toBe(0);
      expect(capturedRunUpdate.status).toBe('COMPLETED');
      expect(capturedRunUpdate.finishedAt.getTime()).toBe(FIXED_TIME.getTime());
    });

    it('unknown result value (e.g. "WHATEVER"): is treated as "done" but counted under none of the three buckets', async () => {
      // The current `cases.every(c => c.result !== 'PENDING')` returns true for any
      // non-PENDING value, including unknown strings. Documenting current behaviour:
      //   - status becomes COMPLETED
      //   - finishedAt becomes fixed time
      //   - the unknown value is not counted in any of the three counters
      prisma.testRunCase.findMany.mockResolvedValue([
        { id: 'rc-1', result: 'WHATEVER' },
        { id: 'rc-2', result: 'PASSED' },
      ]);

      await service.updateTestRunCase(testRunId, runCaseId, { result: 'WHATEVER' }, userId);

      expect(prisma.testRunCase.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: runCaseId },
        data: expect.objectContaining({ result: 'WHATEVER' }),
      }));
      expect(capturedRunUpdate.passedCases).toBe(1);
      expect(capturedRunUpdate.failedCases).toBe(0);
      expect(capturedRunUpdate.skippedCases).toBe(0);
      expect(capturedRunUpdate.status).toBe('COMPLETED');
      expect(capturedRunUpdate.finishedAt.getTime()).toBe(FIXED_TIME.getTime());
    });
  });
});
