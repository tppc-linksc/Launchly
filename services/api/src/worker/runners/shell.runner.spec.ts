import { ShellRunner } from './shell.runner';
import { CommandExecutor } from './command.executor';
import { RunnerContext } from './runner.factory';

type ExecResult = { stdout: string; stderr: string; exitCode: number };

function makeContext(overrides: Partial<RunnerContext> = {}): RunnerContext {
  return {
    taskType: 'HEALTH_CHECK',
    refId: 'deploy-1',
    payload: { host: 'localhost', healthPort: 3000, healthCheckPath: '/health' },
    stageLogCallback: vi.fn(async () => undefined),
    ...overrides,
  };
}

function makeExecutor() {
  return {
    exec: vi.fn<(...args: any[]) => Promise<ExecResult>>(),
    execFile: vi.fn<(...args: any[]) => Promise<ExecResult>>(),
  };
}

function makeRunner(executor: ReturnType<typeof makeExecutor>) {
  return new ShellRunner(executor as unknown as CommandExecutor);
}

describe('ShellRunner build compatibility path', () => {
  it('skips when no install/build command is configured', async () => {
    const executor = makeExecutor();
    const result = await makeRunner(executor).execute(makeContext({ taskType: 'REPO_CLONE', payload: {} }));

    expect(result).toEqual({
      success: true,
      stdout: '未配置构建命令，跳过',
      stderr: '',
      exitCode: 0,
      errorMessage: '',
    });
    expect(executor.exec).not.toHaveBeenCalled();
  });

  it('runs the pipeline in the validated task directory without logging command contents', async () => {
    const executor = makeExecutor();
    executor.exec.mockResolvedValue({
      stdout: 'password=hunter2',
      stderr: 'token=ghp_abcdefghijklmnopqrstuvwxyz',
      exitCode: 1,
    });
    const ctx = makeContext({
      taskType: 'REPO_CLONE',
      payload: { installCommand: 'pnpm install', buildCommand: 'pnpm build' },
    });

    const result = await makeRunner(executor).execute(ctx);

    expect(executor.exec).toHaveBeenCalledWith('pnpm install && pnpm build', {
      cwd: '/tmp/launchly-builds/work-deploy-1',
      timeout: 1200,
    });
    expect(ctx.stageLogCallback).toHaveBeenCalledWith('RUNNING', 'Executing build pipeline (2 steps)');
    expect(result).toMatchObject({ success: false, exitCode: 1, errorMessage: '构建失败' });
    expect(result.stdout).not.toContain('hunter2');
    expect(result.stderr).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz');
  });

  it('rejects unsafe refId before invoking a command', async () => {
    const executor = makeExecutor();
    const result = await makeRunner(executor).execute(
      makeContext({
        taskType: 'REPO_CLONE',
        refId: '../escape',
        payload: { buildCommand: 'pnpm build' },
      }),
    );

    expect(result.success).toBe(false);
    expect(result.errorMessage).toMatch(/refId/);
    expect(executor.exec).not.toHaveBeenCalled();
  });
});

describe('ShellRunner health checks', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it.each(['200', '204'])('accepts an exact successful HTTP status %s', async (status) => {
    const executor = makeExecutor();
    executor.execFile.mockResolvedValue({ stdout: status, stderr: '', exitCode: 0 });
    const ctx = makeContext();

    const result = await makeRunner(executor).execute(ctx);

    expect(executor.execFile).toHaveBeenCalledWith(
      'curl',
      ['-sf', '-o', '/dev/null', '-w', '%{http_code}', 'http://localhost:3000/health'],
      { timeout: 30 },
    );
    expect(ctx.stageLogCallback).toHaveBeenCalledWith('RUNNING', '健康检查: http://localhost:3000/health');
    expect(result).toEqual({
      success: true,
      stdout: `健康检查通过 (${status})`,
      stderr: '',
      exitCode: 0,
      errorMessage: '',
    });
  });

  it.each(['301', '399', '200abc', '', 'abc'])(
    'rejects non-2xx or malformed status %j after exactly ten attempts and nine waits',
    async (status) => {
      vi.useFakeTimers();
      const timeoutSpy = vi.spyOn(global, 'setTimeout');
      const executor = makeExecutor();
      executor.execFile.mockResolvedValue({ stdout: status, stderr: '', exitCode: 0 });

      const pending = makeRunner(executor).execute(makeContext());
      await vi.runAllTimersAsync();
      const result = await pending;

      expect(executor.execFile).toHaveBeenCalledTimes(10);
      expect(timeoutSpy).toHaveBeenCalledTimes(9);
      expect(result.success).toBe(false);
      expect(result.errorMessage).toBe('健康检查失败');
    },
  );

  it('requires curl exitCode 0 even when stdout is 200', async () => {
    vi.useFakeTimers();
    const executor = makeExecutor();
    executor.execFile.mockResolvedValue({ stdout: '200', stderr: 'connection reset', exitCode: 22 });

    const pending = makeRunner(executor).execute(makeContext());
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result.success).toBe(false);
    expect(executor.execFile).toHaveBeenCalledTimes(10);
  });

  it('continues after transient executor errors and succeeds on a later attempt', async () => {
    vi.useFakeTimers();
    const executor = makeExecutor();
    executor.execFile
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ stdout: '503', stderr: '', exitCode: 22 })
      .mockResolvedValueOnce({ stdout: '200', stderr: '', exitCode: 0 });

    const pending = makeRunner(executor).execute(makeContext());
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(executor.execFile).toHaveBeenCalledTimes(3);
    expect(result.success).toBe(true);
  });

  it.each([
    [{ host: 'bad;host', healthPort: 3000, healthCheckPath: '/' }, /host/],
    [{ host: 'localhost', healthPort: 0, healthCheckPath: '/' }, /port/],
    [{ host: 'localhost', healthPort: 65536, healthCheckPath: '/' }, /port/],
    [{ host: 'localhost', healthPort: 3000, healthCheckPath: '/ok;rm' }, /path/],
  ])('rejects unsafe health input before curl: %j', async (payload, expected) => {
    const executor = makeExecutor();
    const result = await makeRunner(executor).execute(makeContext({ payload }));

    expect(result.success).toBe(false);
    expect(result.errorMessage).toMatch(expected);
    expect(executor.execFile).not.toHaveBeenCalled();
  });
});
