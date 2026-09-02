/* eslint-disable @typescript-eslint/no-explicit-any */
import { WorkerService } from './worker.service';
import { RunnerFactory, RunnerResult } from './runners/runner.factory';
import { createPrismaMock, MockPrismaService } from '../../test/helpers/prisma-mock';
import { hostname } from 'os';

// ─── Fixtures & helpers ────────────────────────────────────────────────────

const FIXED_NOW = new Date('2026-08-13T06:00:00.000Z');
const FIXED_NOW_MS = FIXED_NOW.getTime();
const WORKER_ID = 'worker-test';
const TIMEOUT_MIN = 30;
const LEASE_EXPIRES_AT = new Date(FIXED_NOW_MS + TIMEOUT_MIN * 60 * 1000);
const STUCK_CUTOFF = new Date(FIXED_NOW_MS - TIMEOUT_MIN * 60 * 1000);

const ORIGINAL_ENV = {
  workerId: process.env.LAUNCHLY_WORKER_ID,
  timeout: process.env.LAUNCHLY_WORKER_TIMEOUT_MINUTES,
  pollMs: process.env.LAUNCHLY_WORKER_POLL_INTERVAL_MS,
};

beforeAll(() => {
  process.env.LAUNCHLY_WORKER_ID = WORKER_ID;
  process.env.LAUNCHLY_WORKER_TIMEOUT_MINUTES = String(TIMEOUT_MIN);
  process.env.LAUNCHLY_WORKER_POLL_INTERVAL_MS = '60000';
});

// Fix wall-clock `new Date()` to FIXED_NOW so startedAt/finishedAt assertions are exact.
// `vi.spyOn(Date, 'now')` only affects `Date.now()`, not `new Date()`.
// We must not fake setTimeout/setImmediate so async Prisma mocks still resolve.
function pinClock() {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FIXED_NOW);
}
function unpinClock() {
  vi.useRealTimers();
}

afterAll(() => {
  for (const [key, original] of Object.entries(ORIGINAL_ENV)) {
    if (original === undefined) {
      delete process.env[
        key === 'workerId'
          ? 'LAUNCHLY_WORKER_ID'
          : key === 'timeout'
            ? 'LAUNCHLY_WORKER_TIMEOUT_MINUTES'
            : 'LAUNCHLY_WORKER_POLL_INTERVAL_MS'
      ];
    } else if (key === 'workerId') process.env.LAUNCHLY_WORKER_ID = original;
    else if (key === 'timeout') process.env.LAUNCHLY_WORKER_TIMEOUT_MINUTES = original;
    else process.env.LAUNCHLY_WORKER_POLL_INTERVAL_MS = original;
  }
});

function attachModelMissingFromHelper(prisma: MockPrismaService) {
  (prisma as any).workerHeartbeat = { upsert: vi.fn().mockResolvedValue({}) };
  (prisma as any).$queryRaw = vi.fn();
  // A neutral non-terminal stage keeps unrelated success-path tests from
  // accidentally completing a deployment or throwing on an undefined mock.
  prisma.deploymentStageLog.findMany.mockResolvedValue([{ status: 'RUNNING' }] as any);
}

function buildService(prisma: MockPrismaService) {
  const runnerFactory = {
    execute: vi.fn(async () => {
      throw new Error('Unexpected unconfigured RunnerFactory.execute call');
    }),
  } as unknown as vi.Mocked<RunnerFactory>;
  const service = new WorkerService(prisma as any, runnerFactory as any);
  return { service, runnerFactory };
}

function successResult(over: Partial<RunnerResult> = {}): RunnerResult {
  return {
    success: true,
    stdout: 'hello',
    stderr: '',
    exitCode: 0,
    errorMessage: '',
    ...over,
  };
}

function failureResult(over: Partial<RunnerResult> = {}): RunnerResult {
  return {
    success: false,
    stdout: '',
    stderr: 'boom',
    exitCode: 1,
    errorMessage: 'boom',
    ...over,
  };
}

function makePendingRow(over: Partial<any> = {}) {
  return {
    id: 'task-1',
    taskType: 'REPO_CLONE',
    refId: 'deploy-1',
    status: 'PENDING',
    payload: null,
    attempts: 0,
    maxAttempts: 3,
    started_at: null,
    startedAt: null,
    errorMessage: null,
    finishedAt: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    createdAt: FIXED_NOW,
    ...over,
  };
}

function makeRunningRow(over: Partial<any> = {}) {
  const past = new Date(FIXED_NOW_MS - 5 * 60 * 1000);
  return makePendingRow({
    id: 'task-1',
    status: 'RUNNING',
    attempts: 2,
    maxAttempts: 3,
    started_at: past,
    startedAt: past,
    leaseOwner: 'other-worker',
    leaseExpiresAt: STUCK_CUTOFF,
    ...over,
  });
}

function makeClaimedTask(over: Partial<any> = {}) {
  return {
    id: 'task-1',
    taskType: 'REPO_CLONE',
    refId: 'deploy-1',
    status: 'RUNNING',
    attempts: 1,
    maxAttempts: 3,
    payload: '{}',
    startedAt: FIXED_NOW,
    finishedAt: null,
    errorMessage: null,
    leaseOwner: WORKER_ID,
    leaseExpiresAt: LEASE_EXPIRES_AT,
    ...over,
  };
}

function makePENDINGDeployment(over: Partial<any> = {}) {
  return {
    id: 'deploy-1',
    projectId: 'proj-1',
    environmentId: 'env-1',
    deployTargetId: 'target-1',
    status: 'PENDING',
    startedAt: null,
    finishedAt: null,
    accessUrl: null,
    errorMessage: null,
    ...over,
  };
}

function makeStageLog(over: Partial<any> = {}) {
  return {
    id: 'stage-1',
    deploymentId: 'deploy-1',
    stage: 'CLONE',
    stepOrder: 1,
    status: 'PENDING',
    log: '',
    startedAt: null,
    finishedAt: null,
    ...over,
  };
}

describe('WorkerService lease renewal', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('extends only the RUNNING task still owned by this worker and stops cleanly', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    const prisma = createPrismaMock();
    attachModelMissingFromHelper(prisma);
    const { service } = buildService(prisma);

    const stop = (service as any).startLeaseRenewal('task-lease') as () => void;
    await vi.advanceTimersByTimeAsync(60_000);

    expect(prisma.task.updateMany).toHaveBeenCalledWith({
      where: { id: 'task-lease', status: 'RUNNING', leaseOwner: WORKER_ID },
      data: { leaseExpiresAt: new Date(FIXED_NOW_MS + TIMEOUT_MIN * 60 * 1000 + 60_000) },
    });
    stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});

function attachSimpleTx(
  prisma: MockPrismaService,
  opts: {
    rows?: any[];
    updatedTask?: any;
    rollback?: { stage: any; task: any };
  } = {},
) {
  const tx: any = {
    $queryRaw: vi.fn().mockResolvedValue(opts.rows ?? []),
    task: {
      update: vi.fn().mockResolvedValue(opts.updatedTask ?? null),
      create: vi.fn().mockResolvedValue({ id: 'task-new' }),
    },
    deploymentStageLog: {
      create: vi.fn().mockResolvedValue({ id: 'stage-rollback' }),
    },
  };
  if (opts.rollback) {
    tx.deploymentStageLog.create.mockResolvedValue(opts.rollback.stage);
    tx.task.create.mockResolvedValue(opts.rollback.task);
  }
  prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));
  return tx;
}

// ─── heartbeat / onModuleInit ──────────────────────────────────────────────

describe('WorkerService.init / heartbeat', () => {
  let service: WorkerService;
  let prisma: MockPrismaService;
  let runnerFactory: vi.Mocked<RunnerFactory>;

  beforeEach(() => {
    prisma = createPrismaMock();
    attachModelMissingFromHelper(prisma);
    ({ service, runnerFactory } = buildService(prisma));
    pinClock();
  });

  afterEach(() => {
    unpinClock();
    vi.restoreAllMocks();
  });

  it('onModuleInit triggers a heartbeat upsert', async () => {
    await service.onModuleInit();
    expect((prisma as any).workerHeartbeat.upsert).toHaveBeenCalledTimes(1);
  });

  it('heartbeat writes READY with the configured workerId and current pid', async () => {
    await service.heartbeat();
    const call = ((prisma as any).workerHeartbeat.upsert as vi.Mock).mock.calls[0][0];
    expect(call.where).toEqual({ workerId: WORKER_ID });
    expect(call.create.workerId).toBe(WORKER_ID);
    expect(call.create.status).toBe('READY');
    expect(call.update.status).toBe('READY');
    const createDetails = JSON.parse(call.create.details);
    const updateDetails = JSON.parse(call.update.details);
    expect(createDetails.pid).toBe(process.pid);
    expect(updateDetails.pid).toBe(process.pid);
  });

  it('heartbeat propagates database errors', async () => {
    ((prisma as any).workerHeartbeat.upsert as vi.Mock).mockRejectedValueOnce(new Error('db down'));
    await expect(service.heartbeat()).rejects.toThrow('db down');
  });

  it('uses hostname:pid as workerId when LAUNCHLY_WORKER_ID is absent', async () => {
    delete process.env.LAUNCHLY_WORKER_ID;
    try {
      const fallbackPrisma = createPrismaMock();
      attachModelMissingFromHelper(fallbackPrisma);
      const { service: fallbackService } = buildService(fallbackPrisma);

      await fallbackService.heartbeat();

      const call = ((fallbackPrisma as any).workerHeartbeat.upsert as vi.Mock).mock.calls[0][0];
      expect(call.where).toEqual({ workerId: `${hostname()}:${process.pid}` });
      expect(call.create.workerId).toBe(`${hostname()}:${process.pid}`);
    } finally {
      process.env.LAUNCHLY_WORKER_ID = WORKER_ID;
    }
  });
});

// ─── claim transaction (via poll()) ────────────────────────────────────────

describe('WorkerService.poll - claim transaction', () => {
  let service: WorkerService;
  let prisma: MockPrismaService;
  let runnerFactory: vi.Mocked<RunnerFactory>;

  beforeEach(() => {
    prisma = createPrismaMock();
    attachModelMissingFromHelper(prisma);
    ({ service, runnerFactory } = buildService(prisma));
    pinClock();
    // Default: no Deployment / no StageLog lookup interference
    prisma.deployment.findUnique.mockResolvedValue(null);
    prisma.deploymentStageLog.findFirst.mockResolvedValue(null);
  });

  afterEach(() => {
    unpinClock();
    vi.restoreAllMocks();
  });

  function rawSqlText(call: any) {
    const arg = call[0];
    if (arg && Array.isArray(arg.strings)) return arg.strings.join('?');
    return JSON.stringify(call);
  }

  it('returns early when $queryRaw yields no candidate', async () => {
    const tx = attachSimpleTx(prisma, { rows: [] });
    await service.poll();
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.task.update).not.toHaveBeenCalled();
    expect(prisma.task.update).not.toHaveBeenCalled();
    expect(runnerFactory.execute).not.toHaveBeenCalled();
  });

  it('issues raw SQL with the documented clauses', async () => {
    const tx = attachSimpleTx(prisma, { rows: [makePendingRow()] });
    runnerFactory.execute.mockResolvedValue(failureResult({ errorMessage: 'claim-only' }));
    await service.poll();
    const sql = rawSqlText(tx.$queryRaw.mock.calls[0]);
    expect(sql).toContain('PENDING');
    expect(sql).not.toContain("status = 'RUNNING'");
    expect(sql).not.toContain('lease_expires_at');
    expect(sql).toContain('attempts');
    expect(sql).toContain('max_attempts');
    expect(sql).toContain('created_at');
    expect(sql).toContain('FOR UPDATE');
    expect(sql).toContain('SKIP LOCKED');
    expect(sql).toContain('LIMIT 1');
  });

  it('claims a PENDING task: status RUNNING, attempts increment, lease set', async () => {
    const row = makePendingRow();
    const claimed = makeClaimedTask({ attempts: 1 });
    const tx = attachSimpleTx(prisma, { rows: [row], updatedTask: claimed });
    // Setup executeTask to fail quickly so we can observe claim side effects only.
    runnerFactory.execute.mockImplementation(async () => failureResult({ errorMessage: 'x' }));

    await service.poll();

    expect(tx.task.update).toHaveBeenCalledTimes(1);
    const args = tx.task.update.mock.calls[0][0];
    expect(args.where).toEqual({ id: row.id });
    expect(args.data.status).toBe('RUNNING');
    expect(args.data.attempts).toEqual({ increment: 1 });
    expect(args.data.startedAt).toBeInstanceOf(Date);
    expect(args.data.startedAt.getTime()).toBe(FIXED_NOW_MS);
    expect(args.data.leaseOwner).toBe(WORKER_ID);
    expect(args.data.leaseExpiresAt).toBeInstanceOf(Date);
    expect(args.data.leaseExpiresAt.getTime()).toBe(LEASE_EXPIRES_AT.getTime());
  });

  it('resets startedAt when a PENDING task is claimed for a new attempt', async () => {
    const past = new Date(FIXED_NOW_MS - 7 * 60 * 1000);
    const row = makePendingRow({ started_at: past, startedAt: past });
    const claimed = makeClaimedTask({ startedAt: past, attempts: 1 });
    const tx = attachSimpleTx(prisma, { rows: [row], updatedTask: claimed });
    runnerFactory.execute.mockImplementation(async () => failureResult({ errorMessage: 'x' }));

    await service.poll();
    const args = tx.task.update.mock.calls[0][0];
    const startedAt = args.data.startedAt as Date;
    expect(startedAt.getTime()).toBe(FIXED_NOW_MS);
    expect(args.data.attempts).toEqual({ increment: 1 });
  });

  it('defensively treats any row returned by the PENDING-only claim query as a new attempt', async () => {
    const row = makeRunningRow({ attempts: 2 });
    const claimed = makeClaimedTask({ attempts: 2 });
    const tx = attachSimpleTx(prisma, { rows: [row], updatedTask: claimed });
    runnerFactory.execute.mockImplementation(async () => failureResult({ errorMessage: 'x' }));

    await service.poll();
    const args = tx.task.update.mock.calls[0][0];
    expect(args.data.status).toBe('RUNNING');
    expect(args.data.attempts).toEqual({ increment: 1 });
    const startedAt = args.data.startedAt as Date;
    const rowStartedAt = row.started_at as unknown as Date;
    expect(startedAt.getTime()).toBe(FIXED_NOW_MS);
    expect(args.data.leaseOwner).toBe(WORKER_ID);
    expect(args.data.leaseExpiresAt.getTime()).toBe(LEASE_EXPIRES_AT.getTime());
  });

  it('runs the $transaction callback exactly once', async () => {
    const tx = attachSimpleTx(prisma, { rows: [makePendingRow()], updatedTask: makeClaimedTask() });
    runnerFactory.execute.mockImplementation(async () => failureResult({ errorMessage: 'x' }));
    await service.poll();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.task.update).toHaveBeenCalledTimes(1);
  });

  it('propagates $queryRaw errors without claiming a task', async () => {
    const tx = attachSimpleTx(prisma);
    tx.$queryRaw.mockRejectedValueOnce(new Error('sql boom'));
    await expect(service.poll()).rejects.toThrow('sql boom');
    expect(tx.task.update).not.toHaveBeenCalled();
  });

  it('propagates the claim update error', async () => {
    const tx = attachSimpleTx(prisma, { rows: [makePendingRow()] });
    tx.task.update.mockRejectedValueOnce(new Error('update boom'));
    await expect(service.poll()).rejects.toThrow('update boom');
  });
});

// ─── payload parsing (via poll()) ──────────────────────────────────────────

describe('WorkerService.poll - payload parsing', () => {
  let service: WorkerService;
  let prisma: MockPrismaService;
  let runnerFactory: vi.Mocked<RunnerFactory>;

  beforeEach(() => {
    prisma = createPrismaMock();
    attachModelMissingFromHelper(prisma);
    ({ service, runnerFactory } = buildService(prisma));
    pinClock();
    prisma.deployment.findUnique.mockResolvedValue(null);
    prisma.deploymentStageLog.findFirst.mockResolvedValue(null);
  });

  afterEach(() => {
    unpinClock();
    vi.restoreAllMocks();
  });

  it('parses a valid JSON object payload', async () => {
    runnerFactory.execute.mockClear();
    const row = makePendingRow({ payload: '{"foo":"bar","n":1}' });
    attachSimpleTx(prisma, { rows: [row], updatedTask: makeClaimedTask({ payload: row.payload }) });
    runnerFactory.execute.mockImplementation(async () => failureResult({ errorMessage: 'x' }));
    await service.poll();
    const ctx = runnerFactory.execute.mock.calls[0][1];
    expect(ctx.payload).toEqual({ foo: 'bar', n: 1 });
  });

  it('rejects null payload with fatal failure (KI-025 fail closed)', async () => {
    const row = makePendingRow({ payload: null });
    attachSimpleTx(prisma, { rows: [row], updatedTask: makeClaimedTask({ payload: null }) });
    runnerFactory.execute.mockImplementation(async () => failureResult({ errorMessage: 'x' }));
    await service.poll();
    // KI-025: payload 为空/null/非对象一律拒绝；runner 不应被调用。
    expect(runnerFactory.execute).not.toHaveBeenCalled();
  });

  it('rejects empty string payload with fatal failure (KI-025 fail closed)', async () => {
    const row = makePendingRow({ payload: '' });
    attachSimpleTx(prisma, { rows: [row], updatedTask: makeClaimedTask({ payload: '' }) });
    runnerFactory.execute.mockImplementation(async () => failureResult({ errorMessage: 'x' }));
    await service.poll();
    expect(runnerFactory.execute).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON payload with fatal failure (KI-025 fail closed)', async () => {
    const row = makePendingRow({ payload: 'not json{' });
    attachSimpleTx(prisma, { rows: [row], updatedTask: makeClaimedTask({ payload: 'not json{' }) });
    runnerFactory.execute.mockImplementation(async () => failureResult({ errorMessage: 'x' }));
    await service.poll();
    expect(runnerFactory.execute).not.toHaveBeenCalled();
  });

  it('rejects JSON arrays before invoking a runner', async () => {
    const row = makePendingRow({ payload: '[1,2,3]' });
    attachSimpleTx(prisma, { rows: [row], updatedTask: makeClaimedTask({ payload: '[1,2,3]' }) });
    runnerFactory.execute.mockImplementation(async () => failureResult({ errorMessage: 'x' }));
    await service.poll();
    expect(runnerFactory.execute).not.toHaveBeenCalled();
  });

  it('rejects JSON string primitives before invoking a runner', async () => {
    const row = makePendingRow({ payload: '"text"' });
    attachSimpleTx(prisma, { rows: [row], updatedTask: makeClaimedTask({ payload: '"text"' }) });
    runnerFactory.execute.mockImplementation(async () => failureResult({ errorMessage: 'x' }));
    await service.poll();
    expect(runnerFactory.execute).not.toHaveBeenCalled();
  });

  it('rejects JSON number primitives before invoking a runner', async () => {
    const row = makePendingRow({ payload: '123' });
    attachSimpleTx(prisma, { rows: [row], updatedTask: makeClaimedTask({ payload: '123' }) });
    runnerFactory.execute.mockImplementation(async () => failureResult({ errorMessage: 'x' }));
    await service.poll();
    expect(runnerFactory.execute).not.toHaveBeenCalled();
  });

  it('rejects the JSON null literal before invoking a runner', async () => {
    const row = makePendingRow({ payload: 'null' });
    attachSimpleTx(prisma, { rows: [row], updatedTask: makeClaimedTask({ payload: 'null' }) });
    runnerFactory.execute.mockImplementation(async () => failureResult({ errorMessage: 'x' }));
    await service.poll();
    expect(runnerFactory.execute).not.toHaveBeenCalled();
  });
});

// ─── task type → stage mapping (via poll()) ───────────────────────────────

describe('WorkerService.poll - task type / stage mapping', () => {
  let service: WorkerService;
  let prisma: MockPrismaService;
  let runnerFactory: vi.Mocked<RunnerFactory>;

  beforeEach(() => {
    prisma = createPrismaMock();
    attachModelMissingFromHelper(prisma);
    ({ service, runnerFactory } = buildService(prisma));
    pinClock();
    prisma.deployment.findUnique.mockResolvedValue(null);
    prisma.deploymentStageLog.findFirst.mockResolvedValue(null);
  });

  afterEach(() => {
    unpinClock();
    vi.restoreAllMocks();
  });

  const mappings: Array<[string, string]> = [
    ['REPO_CLONE', 'CLONE'],
    ['PROJECT_IMAGE_PREPARE', 'BUILD'],
    ['TEMPLATE_SOURCE', 'CLONE'],
    ['PROJECT_BUILD', 'BUILD'],
    ['PROJECT_DEPLOY', 'DEPLOY'],
    ['PROJECT_BOOTSTRAP', 'BOOTSTRAP'],
    ['HEALTH_CHECK', 'HEALTH_CHECK'],
    ['ROLLBACK_DEPLOY', 'ROLLBACK'],
  ];

  it.each(mappings)('%s maps to stage %s and dispatches the correct taskType', async (taskType, stage) => {
    const row = makePendingRow({ taskType, refId: 'deploy-1', payload: '{}' });
    attachSimpleTx(prisma, { rows: [row], updatedTask: makeClaimedTask({ taskType }) });
    prisma.deployment.findUnique.mockResolvedValue(makePENDINGDeployment({ status: 'RUNNING' }));
    prisma.deploymentStageLog.findFirst.mockResolvedValue(makeStageLog({ stage }));
    runnerFactory.execute.mockImplementation(async () => successResult());

    await service.poll();

    expect(runnerFactory.execute).toHaveBeenCalledTimes(1);
    const [calledType, ctx] = runnerFactory.execute.mock.calls[0];
    expect(calledType).toBe(taskType);
    expect(ctx.refId).toBe('deploy-1');
    expect(typeof ctx.stageLogCallback).toBe('function');
    expect(prisma.deploymentStageLog.findFirst).toHaveBeenCalledTimes(2);
    for (const [args] of prisma.deploymentStageLog.findFirst.mock.calls) {
      expect(args).toEqual({ where: { deploymentId: 'deploy-1', stage } });
    }
    expect(prisma.deploymentStageLog.update.mock.calls.map(([args]) => args.data.status)).toEqual([
      'RUNNING',
      'SUCCEEDED',
    ]);
    expect(prisma.task.update.mock.calls.map(([args]) => args)).toEqual([
      {
        where: { id: 'task-1', status: 'RUNNING', leaseOwner: WORKER_ID },
        data: {
          status: 'SUCCEEDED',
          finishedAt: FIXED_NOW,
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      },
    ]);
    if (taskType === 'ROLLBACK_DEPLOY') {
      expect(prisma.deployment.update.mock.calls.map(([args]) => args)).toEqual([
        {
          where: { id: 'deploy-1' },
          data: { status: 'ROLLED_BACK', finishedAt: FIXED_NOW },
        },
      ]);
    } else {
      expect(prisma.deployment.update).not.toHaveBeenCalled();
    }
  });

  it('unknown task type marks the task FAILED (KI-025 fail closed) without invoking any runner and clears the lease', async () => {
    const row = makePendingRow({ taskType: 'MYSTERY_TASK', payload: '{}' });
    attachSimpleTx(prisma, { rows: [row], updatedTask: makeClaimedTask({ taskType: 'MYSTERY_TASK', payload: '{}' }) });
    await service.poll();
    expect(runnerFactory.execute).not.toHaveBeenCalled();
    expect(prisma.task.update).toHaveBeenCalledTimes(1);
    const args = prisma.task.update.mock.calls[0][0];
    expect(args.where).toEqual({ id: 'task-1', status: 'RUNNING', leaseOwner: WORKER_ID });
    expect(args.data.status).toBe('FAILED');
    expect(args.data.leaseOwner).toBeNull();
    expect(args.data.leaseExpiresAt).toBeNull();
    expect(args.data.finishedAt).toBeInstanceOf(Date);
    expect(prisma.deploymentStageLog.findFirst).not.toHaveBeenCalled();
  });
});

// ─── stage start / stageLogCallback ────────────────────────────────────────

describe('WorkerService.poll - stage log start', () => {
  let service: WorkerService;
  let prisma: MockPrismaService;
  let runnerFactory: vi.Mocked<RunnerFactory>;

  beforeEach(() => {
    prisma = createPrismaMock();
    attachModelMissingFromHelper(prisma);
    ({ service, runnerFactory } = buildService(prisma));
    pinClock();
  });

  afterEach(() => {
    unpinClock();
    vi.restoreAllMocks();
  });

  function boot() {
    const row = makePendingRow({ taskType: 'REPO_CLONE', refId: 'deploy-1' });
    attachSimpleTx(prisma, { rows: [row], updatedTask: makeClaimedTask() });
  }

  it('moves a PENDING deployment to RUNNING and stamps startedAt', async () => {
    boot();
    prisma.deployment.findUnique.mockResolvedValue(makePENDINGDeployment());
    prisma.deploymentStageLog.findFirst.mockResolvedValue(makeStageLog());
    runnerFactory.execute.mockImplementation(async () => successResult());

    await service.poll();
    const update = prisma.deployment.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: 'deploy-1' });
    expect(update.data.status).toBe('RUNNING');
    expect(update.data.startedAt).toBeInstanceOf(Date);
    expect(update.data.startedAt.getTime()).toBe(FIXED_NOW_MS);
  });

  it('does not change a deployment already RUNNING', async () => {
    boot();
    prisma.deployment.findUnique.mockResolvedValue(makePENDINGDeployment({ status: 'RUNNING' }));
    prisma.deploymentStageLog.findFirst.mockResolvedValue(makeStageLog());
    runnerFactory.execute.mockImplementation(async () => successResult());
    await service.poll();
    expect(prisma.deployment.update).not.toHaveBeenCalled();
  });

  it('does not change a deployment already SUCCEEDED', async () => {
    boot();
    prisma.deployment.findUnique.mockResolvedValue(makePENDINGDeployment({ status: 'SUCCEEDED' }));
    prisma.deploymentStageLog.findFirst.mockResolvedValue(makeStageLog());
    runnerFactory.execute.mockImplementation(async () => successResult());
    await service.poll();
    expect(prisma.deployment.update).not.toHaveBeenCalled();
  });

  it('does not change a deployment already FAILED', async () => {
    boot();
    prisma.deployment.findUnique.mockResolvedValue(makePENDINGDeployment({ status: 'FAILED' }));
    prisma.deploymentStageLog.findFirst.mockResolvedValue(makeStageLog());
    runnerFactory.execute.mockImplementation(async () => successResult());
    await service.poll();
    expect(prisma.deployment.update).not.toHaveBeenCalled();
  });

  it('continues when the deployment does not exist (no fake update)', async () => {
    boot();
    prisma.deployment.findUnique.mockResolvedValue(null);
    prisma.deploymentStageLog.findFirst.mockResolvedValue(makeStageLog());
    runnerFactory.execute.mockImplementation(async () => successResult());
    await service.poll();
    expect(prisma.deployment.update).not.toHaveBeenCalled();
    expect(runnerFactory.execute).toHaveBeenCalledTimes(1);
  });

  it('writes RUNNING status and the start log to an empty StageLog row', async () => {
    boot();
    prisma.deployment.findUnique.mockResolvedValue(null);
    prisma.deploymentStageLog.findFirst.mockResolvedValue(makeStageLog({ log: '' }));
    runnerFactory.execute.mockImplementation(async () => successResult());
    await service.poll();
    const update = prisma.deploymentStageLog.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: 'stage-1' });
    expect(update.data.status).toBe('RUNNING');
    expect(update.data.log).toBe('Starting REPO_CLONE...');
    expect(update.data.startedAt).toBeInstanceOf(Date);
  });

  it('appends the start log with a newline when the StageLog already has content and a startedAt', async () => {
    boot();
    prisma.deployment.findUnique.mockResolvedValue(null);
    prisma.deploymentStageLog.findFirst.mockResolvedValue(
      makeStageLog({ log: 'previous line', startedAt: new Date('2026-08-13T05:00:00.000Z') }),
    );
    runnerFactory.execute.mockImplementation(async () => successResult());
    await service.poll();
    const update = prisma.deploymentStageLog.update.mock.calls[0][0];
    expect(update.data.log).toBe('previous line\nStarting REPO_CLONE...');
    // existing startedAt must be preserved
    expect(update.data).not.toHaveProperty('startedAt');
  });

  it('does not write a stage log when no StageLog row exists, but still runs the runner', async () => {
    boot();
    prisma.deployment.findUnique.mockResolvedValue(null);
    prisma.deploymentStageLog.findFirst.mockResolvedValue(null);
    runnerFactory.execute.mockImplementation(async () => successResult());
    await service.poll();
    expect(prisma.deploymentStageLog.update).not.toHaveBeenCalled();
    expect(runnerFactory.execute).toHaveBeenCalledTimes(1);
  });

  it('exercises stageLogCallback: a real call updates the same deployment/stage row', async () => {
    boot();
    prisma.deployment.findUnique.mockResolvedValue(null);
    prisma.deploymentStageLog.findFirst.mockResolvedValue(makeStageLog({ log: 'first' }));
    prisma.deploymentStageLog.findMany.mockResolvedValue([]); // for checkAndUpdateDeployment
    runnerFactory.execute.mockImplementation(async (_t, ctx) => {
      // The runner must call the real callback.
      await ctx.stageLogCallback!('SUCCEEDED', 'runner mid log');
      return successResult({ stdout: 'final stdout' });
    });

    await service.poll();

    const writes = prisma.deploymentStageLog.update.mock.calls.map(([args]) => args);
    expect(writes).toHaveLength(3);
    expect(writes[0]).toEqual({
      where: { id: 'stage-1' },
      data: {
        status: 'RUNNING',
        log: 'first\nStarting REPO_CLONE...',
        startedAt: FIXED_NOW,
      },
    });
    expect(writes[1]).toEqual({
      where: { id: 'stage-1' },
      data: {
        status: 'SUCCEEDED',
        log: 'first\nrunner mid log',
      },
    });
    expect(writes[2]).toEqual({
      where: { id: 'stage-1' },
      data: { status: 'SUCCEEDED', log: 'final stdout', finishedAt: FIXED_NOW },
    });
    expect(prisma.deploymentStageLog.findFirst).toHaveBeenCalledTimes(3);
    for (const [args] of prisma.deploymentStageLog.findFirst.mock.calls) {
      expect(args).toEqual({ where: { deploymentId: 'deploy-1', stage: 'CLONE' } });
    }
  });
});

// ─── Runner success path ───────────────────────────────────────────────────

describe('WorkerService.poll - runner success', () => {
  let service: WorkerService;
  let prisma: MockPrismaService;
  let runnerFactory: vi.Mocked<RunnerFactory>;

  beforeEach(() => {
    prisma = createPrismaMock();
    attachModelMissingFromHelper(prisma);
    ({ service, runnerFactory } = buildService(prisma));
    pinClock();
  });

  afterEach(() => {
    unpinClock();
    vi.restoreAllMocks();
  });

  it('redacts sensitive stdout before persisting the final stage log', async () => {
    const row = makePendingRow({ taskType: 'REPO_CLONE' });
    attachSimpleTx(prisma, { rows: [row], updatedTask: makeClaimedTask() });
    prisma.deployment.findUnique.mockResolvedValue(null);
    prisma.deploymentStageLog.findFirst.mockResolvedValue(makeStageLog());
    prisma.deploymentStageLog.findMany.mockResolvedValue([]); // for checkAndUpdateDeployment
    runnerFactory.execute.mockImplementation(async () =>
      successResult({ stdout: 'connecting with password=hunter2 and ghp_abcdefghijklmnopqrstuvwxyz' }),
    );
    await service.poll();
    const finalWrite = prisma.deploymentStageLog.update.mock.calls.slice(-1)[0][0];
    expect(finalWrite.data.log).not.toContain('hunter2');
    expect(finalWrite.data.log).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz');
    expect(finalWrite.data.log).toContain('[REDACTED]');
  });

  it('marks the task SUCCEEDED, clears the lease, and does not write FAILED', async () => {
    const row = makePendingRow({ taskType: 'REPO_CLONE' });
    attachSimpleTx(prisma, { rows: [row], updatedTask: makeClaimedTask() });
    prisma.deployment.findUnique.mockResolvedValue(null);
    prisma.deploymentStageLog.findFirst.mockResolvedValue(makeStageLog());
    runnerFactory.execute.mockImplementation(async () => successResult());

    await service.poll();

    expect(prisma.task.update.mock.calls.map(([args]) => args)).toEqual([
      {
        where: { id: 'task-1', status: 'RUNNING', leaseOwner: WORKER_ID },
        data: {
          status: 'SUCCEEDED',
          finishedAt: FIXED_NOW,
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      },
    ]);
  });

  it('ROLLBACK_DEPLOY success sets the deployment to ROLLED_BACK and skips checkAndUpdateDeployment', async () => {
    const row = makePendingRow({ taskType: 'ROLLBACK_DEPLOY' });
    attachSimpleTx(prisma, { rows: [row], updatedTask: makeClaimedTask({ taskType: 'ROLLBACK_DEPLOY' }) });
    prisma.deployment.findUnique.mockResolvedValue(makePENDINGDeployment());
    prisma.deploymentStageLog.findFirst.mockResolvedValue(makeStageLog({ stage: 'ROLLBACK' }));
    prisma.deploymentStageLog.findMany.mockResolvedValue([]); // for checkAndUpdateDeployment
    prisma.environment.findUnique.mockResolvedValue(null);
    prisma.deployTarget.findUnique.mockResolvedValue(null);
    runnerFactory.execute.mockImplementation(async () => successResult());

    await service.poll();

    const deployUpdate = prisma.deployment.update.mock.calls.find((c) => c[0].data.status === 'ROLLED_BACK');
    expect(deployUpdate).toBeDefined();
    expect(deployUpdate[0].data.finishedAt).toBeInstanceOf(Date);
    // No SUCCEEDED write on deployment
    const succeededWrite = prisma.deployment.update.mock.calls.find((c) => c[0].data.status === 'SUCCEEDED');
    expect(succeededWrite).toBeUndefined();
    // No next task created
    expect(prisma.task.create).not.toHaveBeenCalled();
  });

  it('automatic rollback points the environment back to the restored previous deployment', async () => {
    const row = makePendingRow({
      taskType: 'ROLLBACK_DEPLOY',
      payload: JSON.stringify({ rollbackDeploymentId: 'deploy-previous' }),
    });
    attachSimpleTx(prisma, {
      rows: [row],
      updatedTask: makeClaimedTask({ taskType: 'ROLLBACK_DEPLOY', payload: row.payload }),
    });
    prisma.deployment.findUnique.mockResolvedValue(makePENDINGDeployment({ status: 'RUNNING' }));
    prisma.deployment.update.mockResolvedValue({
      ...makePENDINGDeployment({ status: 'ROLLED_BACK' }),
      triggerSource: 'MANUAL',
    });
    prisma.deploymentStageLog.findFirst.mockResolvedValue(makeStageLog({ stage: 'ROLLBACK' }));
    runnerFactory.execute.mockImplementation(async () => successResult());

    await service.poll();

    expect(prisma.environment.update).toHaveBeenCalledWith({
      where: { id: 'env-1' },
      data: { status: 'active', currentDeploymentId: 'deploy-previous' },
    });
  });

  it('manual rollback keeps the environment on the restored immutable snapshot', async () => {
    const row = makePendingRow({
      taskType: 'ROLLBACK_DEPLOY',
      payload: JSON.stringify({ rollbackDeploymentId: 'deploy-previous' }),
    });
    attachSimpleTx(prisma, {
      rows: [row],
      updatedTask: makeClaimedTask({ taskType: 'ROLLBACK_DEPLOY', payload: row.payload }),
    });
    prisma.deployment.findUnique.mockResolvedValue(makePENDINGDeployment({ status: 'RUNNING' }));
    prisma.deployment.update.mockResolvedValue({
      ...makePENDINGDeployment({ status: 'ROLLED_BACK' }),
      triggerSource: 'ROLLBACK',
    });
    prisma.deploymentStageLog.findFirst.mockResolvedValue(makeStageLog({ stage: 'ROLLBACK' }));
    runnerFactory.execute.mockImplementation(async () => successResult());

    await service.poll();

    expect(prisma.environment.update).toHaveBeenCalledWith({
      where: { id: 'env-1' },
      data: { status: 'active', currentDeploymentId: 'deploy-previous' },
    });
  });
});

// ─── next stage queue matrix ───────────────────────────────────────────────

describe('WorkerService.poll - next stage queue matrix', () => {
  let service: WorkerService;
  let prisma: MockPrismaService;
  let runnerFactory: vi.Mocked<RunnerFactory>;

  beforeEach(() => {
    prisma = createPrismaMock();
    attachModelMissingFromHelper(prisma);
    ({ service, runnerFactory } = buildService(prisma));
    pinClock();
  });

  afterEach(() => {
    unpinClock();
    vi.restoreAllMocks();
  });

  async function runSuccess(taskType: string, payload: any, refId = 'deploy-1') {
    const row = makePendingRow({ taskType, refId, payload });
    attachSimpleTx(prisma, { rows: [row], updatedTask: makeClaimedTask({ taskType, payload }) });
    prisma.deployment.findUnique.mockResolvedValue(null);
    prisma.deploymentStageLog.findFirst.mockResolvedValue(makeStageLog());
    runnerFactory.execute.mockImplementation(async () => successResult());
    await service.poll();
    expect(prisma.task.update.mock.calls.map(([args]) => args.data.status)).toEqual(['SUCCEEDED']);
  }

  function expectEnqueued(taskType: string, payload: any, refId = 'deploy-1') {
    expect(prisma.task.create).toHaveBeenCalledTimes(1);
    expect(prisma.task.create.mock.calls[0][0]).toEqual({
      data: {
        taskType,
        refId,
        payload,
        idempotencyKey: `${taskType}:${refId}`,
      },
    });
  }

  it('REPO_CLONE → PROJECT_BUILD', async () => {
    await runSuccess('REPO_CLONE', '{"k":1}');
    expectEnqueued('PROJECT_BUILD', '{"k":1}');
  });

  it('PROJECT_IMAGE_PREPARE → PROJECT_DEPLOY', async () => {
    await runSuccess('PROJECT_IMAGE_PREPARE', '{}');
    expectEnqueued('PROJECT_DEPLOY', '{}');
  });

  it('TEMPLATE_SOURCE → PROJECT_BUILD', async () => {
    await runSuccess('TEMPLATE_SOURCE', '{}');
    expectEnqueued('PROJECT_BUILD', '{}');
  });

  it('PROJECT_BUILD → PROJECT_DEPLOY', async () => {
    await runSuccess('PROJECT_BUILD', '{}');
    expectEnqueued('PROJECT_DEPLOY', '{}');
  });

  it('PROJECT_DEPLOY with bootstrapAdminEnabled=true → PROJECT_BOOTSTRAP', async () => {
    await runSuccess('PROJECT_DEPLOY', '{"bootstrapAdminEnabled":true}');
    expectEnqueued('PROJECT_BOOTSTRAP', '{"bootstrapAdminEnabled":true}');
  });

  it('PROJECT_DEPLOY with bootstrapAdminEnabled=false → HEALTH_CHECK', async () => {
    await runSuccess('PROJECT_DEPLOY', '{"bootstrapAdminEnabled":false}');
    expectEnqueued('HEALTH_CHECK', '{"bootstrapAdminEnabled":false}');
  });

  it('PROJECT_DEPLOY with no payload → HEALTH_CHECK', async () => {
    await runSuccess('PROJECT_DEPLOY', '{}');
    expectEnqueued('HEALTH_CHECK', '{}');
  });

  it('PROJECT_BOOTSTRAP → HEALTH_CHECK', async () => {
    await runSuccess('PROJECT_BOOTSTRAP', '{}');
    expectEnqueued('HEALTH_CHECK', '{}');
  });

  it('HEALTH_CHECK success does not enqueue a next stage', async () => {
    await runSuccess('HEALTH_CHECK', '{}');
    expect(prisma.task.create).not.toHaveBeenCalled();
  });

  it('ROLLBACK_DEPLOY success does not enqueue a next stage', async () => {
    const row = makePendingRow({ taskType: 'ROLLBACK_DEPLOY' });
    attachSimpleTx(prisma, { rows: [row], updatedTask: makeClaimedTask({ taskType: 'ROLLBACK_DEPLOY' }) });
    prisma.deployment.findUnique.mockResolvedValue(makePENDINGDeployment());
    prisma.deploymentStageLog.findFirst.mockResolvedValue(makeStageLog({ stage: 'ROLLBACK' }));
    prisma.environment.findUnique.mockResolvedValue(null);
    prisma.deployTarget.findUnique.mockResolvedValue(null);
    runnerFactory.execute.mockImplementation(async () => successResult());
    await service.poll();
    expect(prisma.task.create).not.toHaveBeenCalled();
  });
});

// ─── checkAndUpdateDeployment (via poll success) ───────────────────────────

describe('WorkerService.poll - deployment completion', () => {
  let service: WorkerService;
  let prisma: MockPrismaService;
  let runnerFactory: vi.Mocked<RunnerFactory>;

  beforeEach(() => {
    prisma = createPrismaMock();
    attachModelMissingFromHelper(prisma);
    ({ service, runnerFactory } = buildService(prisma));
    pinClock();
  });

  afterEach(() => {
    unpinClock();
    vi.restoreAllMocks();
  });

  function bootSuccess(taskType = 'REPO_CLONE') {
    const row = makePendingRow({ taskType, refId: 'deploy-1' });
    attachSimpleTx(prisma, { rows: [row], updatedTask: makeClaimedTask({ taskType }) });
    prisma.deployment.findUnique.mockResolvedValue(makePENDINGDeployment());
    prisma.deploymentStageLog.findFirst.mockResolvedValue(makeStageLog());
    runnerFactory.execute.mockImplementation(async () => successResult());
  }

  it('marks Deployment SUCCEEDED when all StageLog rows are SUCCEEDED/SKIPPED and sets the accessUrl', async () => {
    bootSuccess();
    prisma.deploymentStageLog.findMany.mockResolvedValue([
      makeStageLog({ status: 'SUCCEEDED' }),
      makeStageLog({ id: 'stage-2', stage: 'BUILD', stepOrder: 2, status: 'SKIPPED' }),
    ]);
    prisma.environment.findUnique.mockResolvedValue({ id: 'env-1', externalPort: 4000 });
    prisma.deployTarget.findUnique.mockResolvedValue({ id: 'target-1', host: 'nas.example.com' });

    await service.poll();

    const deployUpdate = prisma.deployment.update.mock.calls.find((c) => c[0].data.status === 'SUCCEEDED');
    expect(deployUpdate).toBeDefined();
    expect(deployUpdate[0].data.finishedAt).toBeInstanceOf(Date);
    expect(deployUpdate[0].data.accessUrl).toBe('http://nas.example.com:4000');
    const envUpdate = prisma.environment.update.mock.calls[0][0];
    expect(envUpdate.where).toEqual({ id: 'env-1' });
    expect(envUpdate.data.status).toBe('active');
    expect(envUpdate.data.currentDeploymentId).toBe('deploy-1');
  });

  it('does NOT mark Deployment SUCCEEDED when any stage is FAILED', async () => {
    bootSuccess();
    prisma.deploymentStageLog.findMany.mockResolvedValue([
      makeStageLog({ status: 'SUCCEEDED' }),
      makeStageLog({ id: 'stage-2', stage: 'BUILD', stepOrder: 2, status: 'FAILED' }),
    ]);
    prisma.environment.findUnique.mockResolvedValue({ id: 'env-1', externalPort: 4000 });
    prisma.deployTarget.findUnique.mockResolvedValue({ id: 'target-1', host: 'nas.example.com' });
    await service.poll();
    const succeeded = prisma.deployment.update.mock.calls.find((c) => c[0].data.status === 'SUCCEEDED');
    expect(succeeded).toBeUndefined();
    expect(prisma.environment.update).not.toHaveBeenCalled();
  });

  it('does NOT mark Deployment SUCCEEDED when any stage is RUNNING', async () => {
    bootSuccess();
    prisma.deploymentStageLog.findMany.mockResolvedValue([
      makeStageLog({ status: 'SUCCEEDED' }),
      makeStageLog({ id: 'stage-2', stage: 'BUILD', stepOrder: 2, status: 'RUNNING' }),
    ]);
    prisma.environment.findUnique.mockResolvedValue({ id: 'env-1', externalPort: 4000 });
    prisma.deployTarget.findUnique.mockResolvedValue({ id: 'target-1', host: 'nas.example.com' });
    await service.poll();
    const succeeded = prisma.deployment.update.mock.calls.find((c) => c[0].data.status === 'SUCCEEDED');
    expect(succeeded).toBeUndefined();
  });

  it('does not mark a deployment successful when no stage evidence exists', async () => {
    bootSuccess();
    prisma.deploymentStageLog.findMany.mockResolvedValue([]);
    prisma.environment.findUnique.mockResolvedValue({ id: 'env-1', externalPort: 4000 });
    prisma.deployTarget.findUnique.mockResolvedValue({ id: 'target-1', host: 'nas.example.com' });
    await service.poll();
    const succeeded = prisma.deployment.update.mock.calls.find((c) => c[0].data.status === 'SUCCEEDED');
    expect(succeeded).toBeUndefined();
    expect(prisma.environment.update).not.toHaveBeenCalled();
  });

  it('does not update Deployment/Environment when the deployment is no longer findable', async () => {
    bootSuccess();
    prisma.deploymentStageLog.findMany.mockResolvedValue([makeStageLog({ status: 'SUCCEEDED' })]);
    prisma.deployment.findUnique.mockResolvedValueOnce(makePENDINGDeployment()); // initial lookup
    prisma.deployment.findUnique.mockResolvedValueOnce(null); // checkAndUpdateDeployment lookup
    await service.poll();
    const succeeded = prisma.deployment.update.mock.calls.find((c) => c[0].data.status === 'SUCCEEDED');
    expect(succeeded).toBeUndefined();
    expect(prisma.environment.update).not.toHaveBeenCalled();
  });

  it('preserves an existing accessUrl instead of recomputing one', async () => {
    bootSuccess();
    prisma.deploymentStageLog.findMany.mockResolvedValue([makeStageLog({ status: 'SUCCEEDED' })]);
    prisma.deployment.findUnique.mockResolvedValueOnce(makePENDINGDeployment());
    prisma.deployment.findUnique.mockResolvedValueOnce(
      makePENDINGDeployment({ accessUrl: 'http://pinned.example.com:8080' }),
    );
    await service.poll();
    const succeeded = prisma.deployment.update.mock.calls.find((c) => c[0].data.status === 'SUCCEEDED');
    expect(succeeded[0].data.accessUrl).toBe('http://pinned.example.com:8080');
    expect(prisma.environment.findUnique).not.toHaveBeenCalled();
  });

  it('defaults the external port to 3000 when Environment has no externalPort', async () => {
    bootSuccess();
    prisma.deploymentStageLog.findMany.mockResolvedValue([makeStageLog({ status: 'SUCCEEDED' })]);
    prisma.deployment.findUnique.mockResolvedValueOnce(makePENDINGDeployment());
    prisma.deployment.findUnique.mockResolvedValueOnce(makePENDINGDeployment());
    prisma.environment.findUnique.mockResolvedValue({ id: 'env-1', externalPort: null });
    prisma.deployTarget.findUnique.mockResolvedValue({ id: 'target-1', host: 'nas.example.com' });
    await service.poll();
    const succeeded = prisma.deployment.update.mock.calls.find((c) => c[0].data.status === 'SUCCEEDED');
    expect(succeeded[0].data.accessUrl).toBe('http://nas.example.com:3000');
  });

  it('uses localhost when no deployTargetId is recorded on the deployment', async () => {
    bootSuccess();
    prisma.deploymentStageLog.findMany.mockResolvedValue([makeStageLog({ status: 'SUCCEEDED' })]);
    prisma.deployment.findUnique.mockResolvedValueOnce(makePENDINGDeployment({ deployTargetId: null }));
    prisma.deployment.findUnique.mockResolvedValueOnce(makePENDINGDeployment({ deployTargetId: null }));
    prisma.environment.findUnique.mockResolvedValue({ id: 'env-1', externalPort: 4321 });
    await service.poll();
    const succeeded = prisma.deployment.update.mock.calls.find((c) => c[0].data.status === 'SUCCEEDED');
    expect(succeeded[0].data.accessUrl).toBe('http://localhost:4321');
  });

  it('keeps localhost when deployTargetId is set but the target cannot be found (current behavior)', async () => {
    bootSuccess();
    prisma.deploymentStageLog.findMany.mockResolvedValue([makeStageLog({ status: 'SUCCEEDED' })]);
    prisma.deployment.findUnique.mockResolvedValueOnce(makePENDINGDeployment());
    prisma.deployment.findUnique.mockResolvedValueOnce(makePENDINGDeployment());
    prisma.environment.findUnique.mockResolvedValue({ id: 'env-1', externalPort: 4321 });
    prisma.deployTarget.findUnique.mockResolvedValue(null);
    await service.poll();
    const succeeded = prisma.deployment.update.mock.calls.find((c) => c[0].data.status === 'SUCCEEDED');
    expect(succeeded[0].data.accessUrl).toBe('http://localhost:4321');
  });
});

// ─── runner failure / throw (via poll()) ───────────────────────────────────

describe('WorkerService.poll - runner failure', () => {
  let service: WorkerService;
  let prisma: MockPrismaService;
  let runnerFactory: vi.Mocked<RunnerFactory>;

  beforeEach(() => {
    prisma = createPrismaMock();
    attachModelMissingFromHelper(prisma);
    ({ service, runnerFactory } = buildService(prisma));
    pinClock();
  });

  afterEach(() => {
    unpinClock();
    vi.restoreAllMocks();
  });

  it('retries the task and re-queues PENDING when under maxAttempts; deployment stays alive', async () => {
    const row = makePendingRow({ taskType: 'REPO_CLONE' });
    const claimed = makeClaimedTask({ taskType: 'REPO_CLONE' });
    attachSimpleTx(prisma, { rows: [row], updatedTask: claimed });
    prisma.deployment.findUnique.mockResolvedValue(makePENDINGDeployment());
    prisma.deploymentStageLog.findFirst.mockResolvedValue(makeStageLog());
    runnerFactory.execute.mockImplementation(async () => failureResult({ errorMessage: 'boom' }));

    await service.poll();

    // Task must be requeued PENDING with cleared error/lease.
    const updates = prisma.task.update.mock.calls.map((c) => c[0]);
    const retryWrite = updates.find((c) => c.data.status === 'PENDING' && c.where.id === 'task-1');
    expect(retryWrite).toBeDefined();
    expect(retryWrite.data.errorMessage).toBeNull();
    expect(retryWrite.data.startedAt).toBeNull();
    expect(retryWrite.data.finishedAt).toBeNull();
    expect(retryWrite.data.leaseOwner).toBeNull();
    expect(retryWrite.data.leaseExpiresAt).toBeNull();

    // Deployment must NOT be marked FAILED.
    const deployFail = prisma.deployment.update.mock.calls.find((c) => c[0].data.status === 'FAILED');
    expect(deployFail).toBeUndefined();

    // Current implementation finalizes the stage as FAILED, then immediately
    // changes it back to RUNNING for retry without clearing finishedAt.
    const stageWrites = prisma.deploymentStageLog.update.mock.calls.map(([args]) => args);
    expect(stageWrites.map((args) => args.data.status)).toEqual(['RUNNING', 'FAILED', 'RUNNING']);
    expect(stageWrites[1].data).toEqual({ status: 'FAILED', log: 'boom\n', finishedAt: FIXED_NOW });
    expect(stageWrites[2].data.log).toContain('Retry attempt 1/3: boom');
    expect(stageWrites[2].data).not.toHaveProperty('finishedAt');
  });

  it('writes a retry log on the stage when a runner fails under maxAttempts', async () => {
    const row = makePendingRow({ taskType: 'REPO_CLONE' });
    attachSimpleTx(prisma, { rows: [row], updatedTask: makeClaimedTask({ taskType: 'REPO_CLONE' }) });
    prisma.deployment.findUnique.mockResolvedValue(null);
    prisma.deploymentStageLog.findFirst.mockResolvedValue(makeStageLog());
    runnerFactory.execute.mockImplementation(async () => failureResult({ errorMessage: 'flake' }));
    await service.poll();
    const retryWrite = prisma.deploymentStageLog.update.mock.calls.find(
      (c) => c[0].data.status === 'RUNNING' && c[0].data.log && c[0].data.log.includes('Retry attempt'),
    );
    expect(retryWrite).toBeDefined();
    expect(retryWrite[0].data.log).toContain('flake');
  });

  it('sanitizes both the failed result and following retry log', async () => {
    const row = makePendingRow({ taskType: 'REPO_CLONE' });
    attachSimpleTx(prisma, { rows: [row], updatedTask: makeClaimedTask({ taskType: 'REPO_CLONE' }) });
    prisma.deployment.findUnique.mockResolvedValue(null);
    prisma.deploymentStageLog.findFirst.mockResolvedValue(makeStageLog());
    runnerFactory.execute.mockResolvedValue(
      failureResult({
        errorMessage: 'password=hunter2',
        stdout: 'token=plain-token',
      }),
    );

    await service.poll();

    const stageWrites = prisma.deploymentStageLog.update.mock.calls.map(([args]) => args);
    const failedWrite = stageWrites.find((args) => args.data.status === 'FAILED');
    const retryWrite = stageWrites.at(-1)!;
    expect(failedWrite.data.log).not.toContain('hunter2');
    expect(failedWrite.data.log).toContain('[REDACTED]');
    expect(retryWrite.data.status).toBe('RUNNING');
    expect(retryWrite.data.log).not.toContain('hunter2');
    expect(retryWrite.data.log).toContain('[REDACTED]');
  });

  it('permanently fails task and deployment when attempts reach maxAttempts', async () => {
    const row = makePendingRow({ taskType: 'REPO_CLONE' });
    const claimed = makeClaimedTask({ taskType: 'REPO_CLONE', attempts: 3, maxAttempts: 3 });
    attachSimpleTx(prisma, { rows: [row], updatedTask: claimed });
    prisma.deployment.findUnique.mockImplementation(async () => makePENDINGDeployment());
    prisma.deploymentStageLog.findFirst.mockResolvedValue(makeStageLog());
    // Auto-rollback prerequisites
    prisma.deployment.findUnique.mockResolvedValueOnce(makePENDINGDeployment());
    prisma.deployment.findUnique.mockResolvedValueOnce({
      ...makePENDINGDeployment(),
      projectId: 'proj-1',
      deployTargetId: 'target-1',
    });
    prisma.environment.findUnique.mockResolvedValue({ id: 'env-1', currentDeploymentId: 'prev-1' });
    prisma.deployment.findUnique.mockResolvedValueOnce({
      ...makePENDINGDeployment(),
      projectId: 'proj-1',
      deployTargetId: 'target-1',
    });
    prisma.deployment.findUnique.mockResolvedValueOnce({
      id: 'prev-1',
      projectId: 'proj-1',
      environmentId: 'env-1',
      deployTargetId: 'target-1',
      status: 'SUCCEEDED',
    });
    prisma.task.findFirst.mockResolvedValue(null);
    runnerFactory.execute.mockImplementation(async () => failureResult({ errorMessage: 'final' }));

    await service.poll();

    // Task ended FAILED
    const taskFailed = prisma.task.update.mock.calls.find((c) => c[0].data.status === 'FAILED');
    expect(taskFailed).toBeDefined();
    expect(taskFailed[0].data.errorMessage).toBe('final');
    expect(taskFailed[0].data.finishedAt).toBeInstanceOf(Date);
    expect(taskFailed[0].data.leaseOwner).toBeNull();
    expect(taskFailed[0].data.leaseExpiresAt).toBeNull();
    // Deployment ended FAILED
    const deployFailed = prisma.deployment.update.mock.calls.find((c) => c[0].data.status === 'FAILED');
    expect(deployFailed).toBeDefined();
    expect(deployFailed[0].data.errorMessage).toBe('final');
  });

  it('a runner throw under maxAttempts is caught and the task is re-queued', async () => {
    const row = makePendingRow({ taskType: 'REPO_CLONE' });
    attachSimpleTx(prisma, { rows: [row], updatedTask: makeClaimedTask({ taskType: 'REPO_CLONE' }) });
    prisma.deployment.findUnique.mockResolvedValue(null);
    prisma.deploymentStageLog.findFirst.mockResolvedValue(makeStageLog());
    runnerFactory.execute.mockImplementation(async () => {
      throw new Error('runner exploded');
    });

    await expect(service.poll()).resolves.toBeUndefined();
    const retry = prisma.task.update.mock.calls.find((c) => c[0].data.status === 'PENDING');
    expect(retry).toBeDefined();
    const stageWrites = prisma.deploymentStageLog.update.mock.calls.map(([args]) => args);
    expect(stageWrites.map((args) => args.data.status)).toEqual(['RUNNING', 'RUNNING']);
    expect(stageWrites[1].data.log).toContain('runner exploded');
  });

  it('a runner throw at maxAttempts permanently fails task and deployment', async () => {
    const row = makePendingRow({ taskType: 'REPO_CLONE' });
    attachSimpleTx(prisma, {
      rows: [row],
      updatedTask: makeClaimedTask({ taskType: 'REPO_CLONE', attempts: 3, maxAttempts: 3 }),
    });
    prisma.deployment.findUnique.mockResolvedValue(makePENDINGDeployment());
    prisma.deploymentStageLog.findFirst.mockResolvedValue(makeStageLog());
    runnerFactory.execute.mockImplementation(async () => {
      throw new Error('runner exploded');
    });
    // No rollback pre-reqs; just verify deployment FAILED
    prisma.deployment.findUnique.mockResolvedValue(makePENDINGDeployment());

    await expect(service.poll()).resolves.toBeUndefined();
    const taskFailed = prisma.task.update.mock.calls.find((c) => c[0].data.status === 'FAILED');
    expect(taskFailed).toBeDefined();
    expect(taskFailed[0].data.errorMessage).toBe('runner exploded');
    const deployFailed = prisma.deployment.update.mock.calls.find((c) => c[0].data.status === 'FAILED');
    expect(deployFailed).toBeDefined();
    expect(deployFailed[0].data.errorMessage).toBe('runner exploded');
    // A thrown runner never reaches writeStageLogFinal, leaving the stage RUNNING.
    expect(prisma.deploymentStageLog.update.mock.calls.map(([args]) => args.data.status)).toEqual(['RUNNING']);
  });

  it('uses a stable fallback when a runner error has no message', async () => {
    const row = makePendingRow({ taskType: 'REPO_CLONE' });
    attachSimpleTx(prisma, { rows: [row], updatedTask: makeClaimedTask({ taskType: 'REPO_CLONE' }) });
    prisma.deployment.findUnique.mockResolvedValue(null);
    prisma.deploymentStageLog.findFirst.mockResolvedValue(makeStageLog());
    const err: any = new Error();
    err.message = undefined;
    runnerFactory.execute.mockImplementation(async () => {
      throw err;
    });
    await expect(service.poll()).resolves.toBeUndefined();
    const retry = prisma.task.update.mock.calls.find((c) => c[0].data.status === 'PENDING');
    expect(retry).toBeDefined();
    const retryStage = prisma.deploymentStageLog.update.mock.calls
      .map(([args]) => args)
      .find((args) => args.data.log?.includes('Retry attempt'));
    expect(retryStage.data.log).toContain(': 执行失败');
  });
});

// ─── timeoutStuckTasks ─────────────────────────────────────────────────────

describe('WorkerService.timeoutStuckTasks', () => {
  let service: WorkerService;
  let prisma: MockPrismaService;
  let runnerFactory: vi.Mocked<RunnerFactory>;

  beforeEach(() => {
    prisma = createPrismaMock();
    attachModelMissingFromHelper(prisma);
    ({ service, runnerFactory } = buildService(prisma));
    pinClock();
  });

  afterEach(() => {
    unpinClock();
    vi.restoreAllMocks();
  });

  it('queries by status=RUNNING and startedAt < (now - 30 min)', async () => {
    prisma.task.findMany.mockResolvedValue([]);
    await service.timeoutStuckTasks();
    const where = prisma.task.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('RUNNING');
    expect(where.startedAt.lt).toBeInstanceOf(Date);
    expect(where.startedAt.lt.getTime()).toBe(STUCK_CUTOFF.getTime());
    expect(prisma.task.update).not.toHaveBeenCalled();
    expect(prisma.deployment.update).not.toHaveBeenCalled();
  });

  it('requires both runtime timeout and an expired lease before recovery', async () => {
    prisma.task.findMany.mockResolvedValue([]);
    await service.timeoutStuckTasks();
    const where = prisma.task.findMany.mock.calls[0][0].where;
    expect(where.leaseExpiresAt.lt).toEqual(FIXED_NOW);
  });

  it('defaults timeout to 30 minutes when LAUNCHLY_WORKER_TIMEOUT_MINUTES is absent', async () => {
    delete process.env.LAUNCHLY_WORKER_TIMEOUT_MINUTES;
    try {
      const fallbackPrisma = createPrismaMock();
      attachModelMissingFromHelper(fallbackPrisma);
      const { service: fallbackService } = buildService(fallbackPrisma);
      fallbackPrisma.task.findMany.mockResolvedValue([]);

      await fallbackService.timeoutStuckTasks();

      const cutoff = fallbackPrisma.task.findMany.mock.calls[0][0].where.startedAt.lt as Date;
      expect(cutoff.getTime()).toBe(STUCK_CUTOFF.getTime());
    } finally {
      process.env.LAUNCHLY_WORKER_TIMEOUT_MINUTES = String(TIMEOUT_MIN);
    }
  });

  it('under maxAttempts: writes PENDING with timeout error (KI-027 atomic reset) and leaves deployment alone', async () => {
    const stuck = {
      id: 'task-1',
      taskType: 'REPO_CLONE',
      refId: 'deploy-1',
      attempts: 1,
      maxAttempts: 3,
      startedAt: new Date(FIXED_NOW_MS - 60 * 60 * 1000),
    };
    prisma.task.findMany.mockResolvedValue([stuck]);

    await service.timeoutStuckTasks();

    // KI-027 修复后：有重试预算的任务只写一次 PENDING（不再先写 FAILED 再覆盖），
    // 状态从 RUNNING 直接转回 PENDING，错误信息保留供运维参考。
    const updates = prisma.task.update.mock.calls.map((c) => c[0]);
    expect(updates).toHaveLength(1);
    const pendingWrite = updates[0];
    expect(pendingWrite.where).toEqual({
      id: 'task-1',
      status: 'RUNNING',
      leaseOwner: null,
      leaseExpiresAt: { lt: FIXED_NOW },
    });
    expect(pendingWrite.data.status).toBe('PENDING');
    expect(pendingWrite.data.errorMessage).toContain('30');
    expect(pendingWrite.data.errorMessage).toContain('分钟');
    expect(pendingWrite.data.startedAt).toBeNull();
    expect(pendingWrite.data.finishedAt).toBeNull();
    expect(pendingWrite.data.leaseOwner).toBeNull();
    expect(pendingWrite.data.leaseExpiresAt).toBeNull();

    expect(prisma.deployment.update).not.toHaveBeenCalled();
  });

  it('under maxAttempts: does not write a retry stage log (current behavior)', async () => {
    const stuck = {
      id: 'task-1',
      taskType: 'REPO_CLONE',
      refId: 'deploy-1',
      attempts: 1,
      maxAttempts: 3,
      startedAt: new Date(FIXED_NOW_MS - 60 * 60 * 1000),
    };
    prisma.task.findMany.mockResolvedValue([stuck]);
    await service.timeoutStuckTasks();
    expect(prisma.deploymentStageLog.update).not.toHaveBeenCalled();
    expect(prisma.deploymentStageLog.create).not.toHaveBeenCalled();
  });

  it('at maxAttempts: writes FAILED and triggers failDeployment, no retry', async () => {
    const stuck = {
      id: 'task-1',
      taskType: 'REPO_CLONE',
      refId: 'deploy-1',
      attempts: 3,
      maxAttempts: 3,
      startedAt: new Date(FIXED_NOW_MS - 60 * 60 * 1000),
    };
    prisma.task.findMany.mockResolvedValue([stuck]);
    // No rollback prerequisites so the test focuses on the deployment FAILED side effect.
    prisma.deployment.findUnique.mockResolvedValue(makePENDINGDeployment({ deployTargetId: null }));

    await service.timeoutStuckTasks();

    const updates = prisma.task.update.mock.calls.map((c) => c[0]);
    expect(updates).toHaveLength(1);
    expect(updates[0].data.status).toBe('FAILED');
    expect(updates[0].data.errorMessage).toContain('30');
    expect(updates[0].data.errorMessage).toContain('分钟');
    const deployUpdate = prisma.deployment.update.mock.calls.find((c) => c[0].data.status === 'FAILED');
    expect(deployUpdate).toBeDefined();
    expect(deployUpdate[0].data.errorMessage).toContain('任务超时失败');
  });

  it('processes multiple stuck tasks independently (KI-027: each writes one PENDING)', async () => {
    const stuck1 = {
      id: 'task-1',
      taskType: 'REPO_CLONE',
      refId: 'deploy-1',
      attempts: 1,
      maxAttempts: 3,
      startedAt: new Date(FIXED_NOW_MS - 60 * 60 * 1000),
    };
    const stuck2 = {
      id: 'task-2',
      taskType: 'PROJECT_BUILD',
      refId: 'deploy-2',
      attempts: 1,
      maxAttempts: 3,
      startedAt: new Date(FIXED_NOW_MS - 60 * 60 * 1000),
    };
    prisma.task.findMany.mockResolvedValue([stuck1, stuck2]);
    await service.timeoutStuckTasks();
    const updates = prisma.task.update.mock.calls.map((c) => c[0]);
    // KI-027 修复后：有重试预算的任务只写一次 PENDING（不再先 FAILED 再 PENDING）。
    const pendingIds = updates.filter((c) => c.data.status === 'PENDING').map((c) => c.where.id);
    expect(pendingIds).toEqual(expect.arrayContaining(['task-1', 'task-2']));
    expect(updates).toHaveLength(2);
  });

  it('continues the timeout batch when recovering one stuck task fails', async () => {
    const stuck1 = {
      id: 'task-1',
      taskType: 'REPO_CLONE',
      refId: 'deploy-1',
      attempts: 1,
      maxAttempts: 3,
      startedAt: new Date(FIXED_NOW_MS - 60 * 60 * 1000),
    };
    const stuck2 = {
      id: 'task-2',
      taskType: 'PROJECT_BUILD',
      refId: 'deploy-2',
      attempts: 1,
      maxAttempts: 3,
      startedAt: new Date(FIXED_NOW_MS - 60 * 60 * 1000),
    };
    prisma.task.findMany.mockResolvedValue([stuck1, stuck2]);
    prisma.task.update.mockRejectedValueOnce(new Error('first update failed'));

    await expect(service.timeoutStuckTasks()).resolves.toBeUndefined();

    expect(prisma.task.update).toHaveBeenCalledTimes(2);
    expect(prisma.task.update.mock.calls[0][0].where).toEqual(expect.objectContaining({ id: 'task-1' }));
    expect(prisma.task.update.mock.calls.some(([args]) => args.where.id === 'task-2')).toBe(true);
  });

  it('does nothing when the timeout query returns no stuck tasks', async () => {
    prisma.task.findMany.mockResolvedValue([]);
    await service.timeoutStuckTasks();
    expect(prisma.task.update).not.toHaveBeenCalled();
  });

  it('propagates prisma.task.findMany errors', async () => {
    prisma.task.findMany.mockRejectedValueOnce(new Error('find down'));
    await expect(service.timeoutStuckTasks()).rejects.toThrow('find down');
  });
});

// ─── automatic rollback (via poll() / timeoutStuckTasks) ────────────────────

describe('WorkerService - automatic rollback', () => {
  let service: WorkerService;
  let prisma: MockPrismaService;
  let runnerFactory: vi.Mocked<RunnerFactory>;

  function standardFailedDeploymentFixture() {
    return makePENDINGDeployment({
      id: 'deploy-failed',
      projectId: 'proj-1',
      environmentId: 'env-1',
      deployTargetId: 'target-1',
    });
  }

  beforeEach(() => {
    prisma = createPrismaMock();
    attachModelMissingFromHelper(prisma);
    ({ service, runnerFactory } = buildService(prisma));
    pinClock();
  });

  afterEach(() => {
    unpinClock();
    vi.restoreAllMocks();
  });

  it('skips rollback when the failed deployment can no longer be found', async () => {
    const stuck = {
      id: 'task-1',
      taskType: 'REPO_CLONE',
      refId: 'deploy-missing',
      attempts: 3,
      maxAttempts: 3,
      startedAt: new Date(FIXED_NOW_MS - 60 * 60 * 1000),
    };
    prisma.task.findMany.mockResolvedValue([stuck]);
    prisma.deployment.findUnique.mockResolvedValueOnce(null);

    await service.timeoutStuckTasks();

    expect(prisma.deployment.update).toHaveBeenCalledWith({
      where: { id: 'deploy-missing' },
      data: {
        status: 'FAILED',
        errorMessage: '任务超时失败，已无重试次数',
        finishedAt: FIXED_NOW,
      },
    });
    expect(prisma.environment.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('skips rollback when failed deployment has no deployTargetId', async () => {
    const stuck = {
      id: 'task-1',
      taskType: 'REPO_CLONE',
      refId: 'deploy-failed',
      attempts: 3,
      maxAttempts: 3,
      startedAt: new Date(FIXED_NOW_MS - 60 * 60 * 1000),
    };
    prisma.task.findMany.mockResolvedValue([stuck]);
    prisma.task.update.mockResolvedValueOnce({ id: stuck.id, status: 'FAILED' });
    const noTarget: any = standardFailedDeploymentFixture();
    noTarget.deployTargetId = null;
    prisma.deployment.findUnique.mockImplementation(async () => noTarget);

    await service.timeoutStuckTasks();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.task.create).not.toHaveBeenCalled();
  });

  it('skips rollback when environment is not found', async () => {
    const stuck = {
      id: 'task-1',
      taskType: 'REPO_CLONE',
      refId: 'deploy-failed',
      attempts: 3,
      maxAttempts: 3,
      startedAt: new Date(FIXED_NOW_MS - 60 * 60 * 1000),
    };
    prisma.task.findMany.mockResolvedValue([stuck]);
    prisma.task.update.mockResolvedValueOnce({ id: stuck.id, status: 'FAILED' });
    prisma.deployment.findUnique.mockResolvedValueOnce(standardFailedDeploymentFixture());
    prisma.environment.findUnique.mockResolvedValueOnce(null);

    await service.timeoutStuckTasks();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('skips rollback when environment has no currentDeploymentId', async () => {
    const stuck = {
      id: 'task-1',
      taskType: 'REPO_CLONE',
      refId: 'deploy-failed',
      attempts: 3,
      maxAttempts: 3,
      startedAt: new Date(FIXED_NOW_MS - 60 * 60 * 1000),
    };
    prisma.task.findMany.mockResolvedValue([stuck]);
    prisma.task.update.mockResolvedValueOnce({ id: stuck.id, status: 'FAILED' });
    prisma.deployment.findUnique.mockResolvedValueOnce(standardFailedDeploymentFixture());
    prisma.environment.findUnique.mockResolvedValueOnce({ id: 'env-1', currentDeploymentId: null });

    await service.timeoutStuckTasks();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('skips rollback when currentDeploymentId equals the failed deployment id', async () => {
    const stuck = {
      id: 'task-1',
      taskType: 'REPO_CLONE',
      refId: 'deploy-failed',
      attempts: 3,
      maxAttempts: 3,
      startedAt: new Date(FIXED_NOW_MS - 60 * 60 * 1000),
    };
    prisma.task.findMany.mockResolvedValue([stuck]);
    prisma.task.update.mockResolvedValueOnce({ id: stuck.id, status: 'FAILED' });
    prisma.deployment.findUnique.mockResolvedValueOnce(standardFailedDeploymentFixture());
    prisma.environment.findUnique.mockResolvedValueOnce({ id: 'env-1', currentDeploymentId: 'deploy-failed' });

    await service.timeoutStuckTasks();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('skips rollback when the previous deployment does not exist', async () => {
    const stuck = {
      id: 'task-1',
      taskType: 'REPO_CLONE',
      refId: 'deploy-failed',
      attempts: 3,
      maxAttempts: 3,
      startedAt: new Date(FIXED_NOW_MS - 60 * 60 * 1000),
    };
    prisma.task.findMany.mockResolvedValue([stuck]);
    prisma.task.update.mockResolvedValueOnce({ id: stuck.id, status: 'FAILED' });
    prisma.deployment.findUnique.mockResolvedValueOnce(standardFailedDeploymentFixture());
    prisma.environment.findUnique.mockResolvedValueOnce({ id: 'env-1', currentDeploymentId: 'prev-1' });
    prisma.deployment.findUnique.mockResolvedValueOnce(null);

    await service.timeoutStuckTasks();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('skips rollback when the previous deployment is not SUCCEEDED', async () => {
    const stuck = {
      id: 'task-1',
      taskType: 'REPO_CLONE',
      refId: 'deploy-failed',
      attempts: 3,
      maxAttempts: 3,
      startedAt: new Date(FIXED_NOW_MS - 60 * 60 * 1000),
    };
    prisma.task.findMany.mockResolvedValue([stuck]);
    prisma.task.update.mockResolvedValueOnce({ id: stuck.id, status: 'FAILED' });
    prisma.deployment.findUnique.mockResolvedValueOnce(standardFailedDeploymentFixture());
    prisma.environment.findUnique.mockResolvedValueOnce({ id: 'env-1', currentDeploymentId: 'prev-1' });
    prisma.deployment.findUnique.mockResolvedValueOnce({
      id: 'prev-1',
      projectId: 'proj-1',
      environmentId: 'env-1',
      deployTargetId: 'target-1',
      status: 'FAILED',
    });

    await service.timeoutStuckTasks();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('skips rollback when the previous deployment is on a different deployTargetId', async () => {
    const stuck = {
      id: 'task-1',
      taskType: 'REPO_CLONE',
      refId: 'deploy-failed',
      attempts: 3,
      maxAttempts: 3,
      startedAt: new Date(FIXED_NOW_MS - 60 * 60 * 1000),
    };
    prisma.task.findMany.mockResolvedValue([stuck]);
    prisma.task.update.mockResolvedValueOnce({ id: stuck.id, status: 'FAILED' });
    prisma.deployment.findUnique.mockResolvedValueOnce(standardFailedDeploymentFixture());
    prisma.environment.findUnique.mockResolvedValueOnce({ id: 'env-1', currentDeploymentId: 'prev-1' });
    prisma.deployment.findUnique.mockResolvedValueOnce({
      id: 'prev-1',
      projectId: 'proj-1',
      environmentId: 'env-1',
      deployTargetId: 'target-2',
      status: 'SUCCEEDED',
    });

    await service.timeoutStuckTasks();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('skips rollback when a ROLLBACK_DEPLOY task already exists for the failed deployment', async () => {
    const stuck = {
      id: 'task-1',
      taskType: 'REPO_CLONE',
      refId: 'deploy-failed',
      attempts: 3,
      maxAttempts: 3,
      startedAt: new Date(FIXED_NOW_MS - 60 * 60 * 1000),
    };
    prisma.task.findMany.mockResolvedValue([stuck]);
    prisma.task.update.mockResolvedValueOnce({ id: stuck.id, status: 'FAILED' });
    prisma.deployment.findUnique.mockResolvedValueOnce(standardFailedDeploymentFixture());
    prisma.environment.findUnique.mockResolvedValueOnce({ id: 'env-1', currentDeploymentId: 'prev-1' });
    prisma.deployment.findUnique.mockResolvedValueOnce({
      id: 'prev-1',
      projectId: 'proj-1',
      environmentId: 'env-1',
      deployTargetId: 'target-1',
      status: 'SUCCEEDED',
    });
    prisma.task.findFirst.mockResolvedValueOnce({ id: 'existing-rollback', taskType: 'ROLLBACK_DEPLOY' });

    await service.timeoutStuckTasks();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('creates the rollback StageLog and the ROLLBACK_DEPLOY task in a single transaction when all preconditions hold', async () => {
    const stuck = {
      id: 'task-1',
      taskType: 'REPO_CLONE',
      refId: 'deploy-failed',
      attempts: 3,
      maxAttempts: 3,
      startedAt: new Date(FIXED_NOW_MS - 60 * 60 * 1000),
    };
    prisma.task.findMany.mockResolvedValue([stuck]);
    prisma.task.update.mockResolvedValueOnce({ id: stuck.id, status: 'FAILED' });
    prisma.deployment.findUnique.mockResolvedValueOnce(standardFailedDeploymentFixture());
    prisma.environment.findUnique.mockResolvedValueOnce({ id: 'env-1', currentDeploymentId: 'prev-1' });
    prisma.deployment.findUnique.mockResolvedValueOnce({
      id: 'prev-1',
      projectId: 'proj-1',
      environmentId: 'env-1',
      deployTargetId: 'target-1',
      status: 'SUCCEEDED',
    });
    prisma.task.findFirst.mockResolvedValueOnce(null);

    const tx = attachSimpleTx(prisma, { rollback: { stage: { id: 'rb-stage' }, task: { id: 'rb-task' } } });

    await service.timeoutStuckTasks();

    // Transaction callback runs exactly once.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // StageLog create with ROLLBACK + stepOrder 5 + PENDING + log carrying the error
    expect(tx.deploymentStageLog.create).toHaveBeenCalledTimes(1);
    const stageCall = tx.deploymentStageLog.create.mock.calls[0][0];
    expect(stageCall.data.deploymentId).toBe('deploy-failed');
    expect(stageCall.data.stage).toBe('ROLLBACK');
    expect(stageCall.data.stepOrder).toBe(6);
    expect(stageCall.data.status).toBe('PENDING');
    expect(stageCall.data.log).toContain('Automatic rollback scheduled after');
    expect(stageCall.data.log).toContain('任务超时失败');
    // ROLLBACK_DEPLOY task create
    expect(tx.task.create).toHaveBeenCalledTimes(1);
    const taskCall = tx.task.create.mock.calls[0][0];
    expect(taskCall.data.taskType).toBe('ROLLBACK_DEPLOY');
    expect(taskCall.data.refId).toBe('deploy-failed');
    expect(taskCall.data.idempotencyKey).toBe('rollback:deploy-failed');
    const payload = JSON.parse(taskCall.data.payload);
    expect(payload).toEqual({
      projectId: 'proj-1',
      environmentId: 'env-1',
      deployTargetId: 'target-1',
      rollbackDeploymentId: 'prev-1',
    });
  });
});
