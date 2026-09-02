import {
  ROLLBACK_STEP_ORDER,
  finalizeTimedOutTask,
  isDeploymentStagesComplete,
  mapTaskTypeToStage,
  rescheduleTimedOutTask,
} from './worker-state-machine';
import { createPrismaMock, MockPrismaService } from '../../test/helpers/prisma-mock';

/**
 * Worker 状态机辅助模块单元测试（KI-025 / KI-026 / KI-027 / KI-029）。
 *
 * 重点：
 * - isDeploymentStagesComplete 不能把空集合 every() 误判为 true；
 * - mapTaskTypeToStage 是显式映射，未知值返回 null；
 * - rescheduleTimedOutTask 必须清 lease 与 finishedAt；
 * - finalizeTimedOutTask 必须写 FAILED 并清 lease。
 */
describe('worker-state-machine', () => {
  let prisma: MockPrismaService;

  beforeEach(() => {
    prisma = createPrismaMock();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  // ============================================================
  // A. isDeploymentStagesComplete
  // ============================================================
  describe('A. isDeploymentStagesComplete', () => {
    it('空集合 → 返回 false（不能误判为完成）', () => {
      expect(isDeploymentStagesComplete([])).toBe(false);
    });

    it('undefined / null → 视为未完成（false）', () => {
      expect(isDeploymentStagesComplete(undefined as any)).toBe(false);
      expect(isDeploymentStagesComplete(null as any)).toBe(false);
    });

    it('全部 SUCCEEDED → true', () => {
      const logs = [{ status: 'SUCCEEDED' }, { status: 'SUCCEEDED' }, { status: 'SUCCEEDED' }];
      expect(isDeploymentStagesComplete(logs)).toBe(true);
    });

    it('全部 SKIPPED → true（KI-026：SKIPPED 也算阶段完成）', () => {
      const logs = [{ status: 'SKIPPED' }, { status: 'SKIPPED' }];
      expect(isDeploymentStagesComplete(logs)).toBe(true);
    });

    it('SUCCEEDED + SKIPPED 混合 → true', () => {
      const logs = [{ status: 'SUCCEEDED' }, { status: 'SKIPPED' }, { status: 'SUCCEEDED' }];
      expect(isDeploymentStagesComplete(logs)).toBe(true);
    });

    it('出现任意 FAILED → false', () => {
      const logs = [{ status: 'SUCCEEDED' }, { status: 'FAILED' }, { status: 'SUCCEEDED' }];
      expect(isDeploymentStagesComplete(logs)).toBe(false);
    });

    it('出现任意 RUNNING → false', () => {
      const logs = [{ status: 'SUCCEEDED' }, { status: 'RUNNING' }];
      expect(isDeploymentStagesComplete(logs)).toBe(false);
    });

    it('出现任意 PENDING → false', () => {
      const logs = [{ status: 'PENDING' }, { status: 'SUCCEEDED' }];
      expect(isDeploymentStagesComplete(logs)).toBe(false);
    });

    it('status=null → false（视为未完成）', () => {
      const logs = [{ status: null }, { status: 'SUCCEEDED' }];
      expect(isDeploymentStagesComplete(logs)).toBe(false);
    });

    it('未知 status（如 CANCELLED）→ false', () => {
      const logs = [{ status: 'SUCCEEDED' }, { status: 'CANCELLED' }];
      expect(isDeploymentStagesComplete(logs)).toBe(false);
    });

    it('单条 SUCCEEDED → true', () => {
      expect(isDeploymentStagesComplete([{ status: 'SUCCEEDED' }])).toBe(true);
    });
    it('单条 SKIPPED → true', () => {
      expect(isDeploymentStagesComplete([{ status: 'SKIPPED' }])).toBe(true);
    });
  });

  // ============================================================
  // B. mapTaskTypeToStage
  // ============================================================
  describe('B. mapTaskTypeToStage', () => {
    it.each([
      ['REPO_CLONE', 'CLONE'],
      ['PROJECT_IMAGE_PREPARE', 'BUILD'],
      ['TEMPLATE_SOURCE', 'CLONE'],
      ['PROJECT_BUILD', 'BUILD'],
      ['PROJECT_DEPLOY', 'DEPLOY'],
      ['PROJECT_BOOTSTRAP', 'BOOTSTRAP'],
      ['HEALTH_CHECK', 'HEALTH_CHECK'],
      ['ROLLBACK_DEPLOY', 'ROLLBACK'],
    ])('mapTaskTypeToStage(%s) === %s', (taskType, expected) => {
      expect(mapTaskTypeToStage(taskType)).toBe(expected);
    });

    it('未知 taskType → 返回 null（不再兜底为某个 stage）', () => {
      expect(mapTaskTypeToStage('UNKNOWN_TYPE')).toBeNull();
      expect(mapTaskTypeToStage('')).toBeNull();
      expect(mapTaskTypeToStage('clone')).toBeNull(); // 大小写敏感
    });
  });

  // ============================================================
  // C. ROLLBACK_STEP_ORDER
  // ============================================================
  describe('C. ROLLBACK_STEP_ORDER 常量（KI-029）', () => {
    it('rollback 的 stepOrder 必须大于 HEALTH_CHECK 的 5', () => {
      // HEALTH_CHECK 默认 stepOrder=5（参考代码注释），rollback 必须在其之后以保证 UI 时间线稳定。
      expect(ROLLBACK_STEP_ORDER).toBeGreaterThan(5);
      expect(ROLLBACK_STEP_ORDER).toBe(6);
    });
  });

  // ============================================================
  // D. rescheduleTimedOutTask
  // ============================================================
  describe('D. rescheduleTimedOutTask', () => {
    it('把任务原子化回到 PENDING：清 lease、重置 startedAt/finishedAt、写 errorMessage', async () => {
      prisma.task.update.mockResolvedValue({ id: 't-1', status: 'PENDING' });

      const before = Date.now();
      await rescheduleTimedOutTask(prisma as any, 't-1', 'timeout');
      const after = Date.now();

      const args = (prisma.task.update as vi.Mock).mock.calls[0][0];
      expect(args.where).toEqual(expect.objectContaining({ id: 't-1', status: 'RUNNING', leaseOwner: null }));
      expect(args.where.leaseExpiresAt.lt).toBeInstanceOf(Date);
      expect(args.data.status).toBe('PENDING');
      expect(args.data.errorMessage).toBe('timeout');
      expect(args.data.startedAt).toBeNull();
      expect(args.data.finishedAt).toBeNull();
      expect(args.data.leaseOwner).toBeNull();
      expect(args.data.leaseExpiresAt).toBeNull();
      void before;
      void after;
    });

    it('直接转发 prisma.task.update 的返回值', async () => {
      const updated = { id: 't-1', status: 'PENDING' };
      prisma.task.update.mockResolvedValue(updated);

      const result = await rescheduleTimedOutTask(prisma as any, 't-1', 'x');

      expect(result).toBe(updated);
    });

    it('Prisma 错误原样抛出', async () => {
      const err = new Error('update-failed');
      prisma.task.update.mockRejectedValue(err);

      await expect(rescheduleTimedOutTask(prisma as any, 't-1', 'x')).rejects.toBe(err);
    });
  });

  // ============================================================
  // E. finalizeTimedOutTask
  // ============================================================
  describe('E. finalizeTimedOutTask', () => {
    it('写 FAILED、清 lease、写 finishedAt=当前时间', async () => {
      prisma.task.update.mockResolvedValue({ id: 't-1', status: 'FAILED' });

      const before = Date.now();
      await finalizeTimedOutTask(prisma as any, 't-1', 'dead');
      const after = Date.now();

      const args = (prisma.task.update as vi.Mock).mock.calls[0][0];
      expect(args.where).toEqual(expect.objectContaining({ id: 't-1', status: 'RUNNING', leaseOwner: null }));
      expect(args.where.leaseExpiresAt.lt).toBeInstanceOf(Date);
      expect(args.data.status).toBe('FAILED');
      expect(args.data.errorMessage).toBe('dead');
      expect(args.data.leaseOwner).toBeNull();
      expect(args.data.leaseExpiresAt).toBeNull();
      expect(args.data.finishedAt).toBeInstanceOf(Date);
      const t = args.data.finishedAt.getTime();
      expect(t).toBeGreaterThanOrEqual(before);
      expect(t).toBeLessThanOrEqual(after);
    });

    it('直接转发 prisma.task.update 的返回值', async () => {
      const updated = { id: 't-1', status: 'FAILED' };
      prisma.task.update.mockResolvedValue(updated);

      const result = await finalizeTimedOutTask(prisma as any, 't-1', 'x');

      expect(result).toBe(updated);
    });

    it('Prisma 错误原样抛出', async () => {
      const err = new Error('finalize-failed');
      prisma.task.update.mockRejectedValue(err);

      await expect(finalizeTimedOutTask(prisma as any, 't-1', 'x')).rejects.toBe(err);
    });
  });
});
