/* eslint-disable @typescript-eslint/no-explicit-any */
import * as path from 'path';
import { ShellRunner } from './shell.runner';
import { CommandExecutor } from './command.executor';
import { RunnerContext } from './runner.factory';

// ─── Executor mock ──────────────────────────────────────────────────────────

interface ExecResult {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  throw?: Error;
}

interface ExecCall {
  command: string;
  options: any;
}

let execCalls: ExecCall[] = [];
let execResults: ExecResult[] = [];

function makeExecutor(): CommandExecutor {
  return {
    exec: jest.fn(async (command: string, options: any) => {
      execCalls.push({ command, options });
      if (execResults.length === 0) {
        throw new Error(`Unexpected unconfigured exec call: ${command}`);
      }
      const r = execResults.shift()!;
      if (r.throw) throw r.throw;
      return {
        stdout: r.stdout ?? '',
        stderr: r.stderr ?? '',
        exitCode: r.exitCode ?? 0,
      };
    }),
  } as unknown as CommandExecutor;
}

function queueExec(r: ExecResult): void {
  execResults.push(r);
}

// ─── setTimeout interception (to avoid real 5-second waits) ────────────────

interface PendingTimeout {
  ms: number;
  callback: () => void;
}
let pendingTimeouts: PendingTimeout[] = [];
let setTimeoutSpy: jest.SpyInstance | null = null;

function installSetTimeoutSpy(): void {
  pendingTimeouts = [];
  setTimeoutSpy = jest
    .spyOn(global, 'setTimeout')
    .mockImplementation(((
      cb: any,
      ms: number,
      ...args: any[]
    ) => {
      if (typeof cb === 'function') {
        pendingTimeouts.push({ ms, callback: () => (cb as any)(...args) });
      }
      return 0 as any;
    }) as any);
}

function allTimeoutMs(): number[] {
  return pendingTimeouts.map((t) => t.ms);
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function drainTimeouts(maxIterations = 30): Promise<number[]> {
  const observed: number[] = [];
  for (let i = 0; i < maxIterations; i++) {
    await flushMicrotasks();
    if (pendingTimeouts.length === 0) break;
    const t = pendingTimeouts.shift()!;
    observed.push(t.ms);
    t.callback();
  }
  return observed;
}

beforeEach(() => {
  execCalls = [];
  execResults = [];
  installSetTimeoutSpy();
});

afterEach(() => {
  const unconsumedExecResults = execResults.length;
  if (setTimeoutSpy) {
    setTimeoutSpy.mockRestore();
    setTimeoutSpy = null;
  }
  pendingTimeouts = [];
  expect(unconsumedExecResults).toBe(0);
});

// ─── helpers ───────────────────────────────────────────────────────────────

const BUILD_ROOT = '/tmp/launchly-builds';

function makeContext(over: Partial<RunnerContext> = {}): RunnerContext {
  return {
    taskType: 'REPO_CLONE',
    refId: 'deploy-1',
    payload: {},
    stageLogCallback: undefined,
    ...over,
  };
}

function makeShellRunner(): ShellRunner {
  return new ShellRunner(makeExecutor());
}

// ─── Build mode: command gating ────────────────────────────────────────────

describe('ShellRunner.execute - build mode: command gating (no install/build => no exec)', () => {
  it('empty payload returns "No build commands configured" with full success result; executor never called', async () => {
    const runner = makeShellRunner();
    const ctx = makeContext({ taskType: 'REPO_CLONE', payload: {} });

    const result = await runner.execute(ctx);

    expect(result).toEqual({
      success: true,
      stdout: 'No build commands configured',
      stderr: '',
      exitCode: 0,
      errorMessage: '',
    });
    expect(execCalls).toEqual([]);
  });

  it('only startCommand is ignored: returns "No build commands configured"; executor never called (current behavior)', async () => {
    const runner = makeShellRunner();
    const ctx = makeContext({ taskType: 'REPO_CLONE', payload: { startCommand: 'npm start' } });

    const result = await runner.execute(ctx);

    expect(result).toEqual({
      success: true,
      stdout: 'No build commands configured',
      stderr: '',
      exitCode: 0,
      errorMessage: '',
    });
    expect(execCalls).toEqual([]);
  });

  it('only testCommand is ignored: returns "No build commands configured"; executor never called (current behavior)', async () => {
    const runner = makeShellRunner();
    const ctx = makeContext({ taskType: 'REPO_CLONE', payload: { testCommand: 'pnpm test' } });

    const result = await runner.execute(ctx);

    expect(result.stdout).toBe('No build commands configured');
    expect(result.success).toBe(true);
    expect(execCalls).toEqual([]);
  });

  it('empty-string installCommand is ignored: returns "No build commands configured"; executor never called', async () => {
    const runner = makeShellRunner();
    const ctx = makeContext({ taskType: 'REPO_CLONE', payload: { installCommand: '' } });

    const result = await runner.execute(ctx);

    expect(result.stdout).toBe('No build commands configured');
    expect(result.success).toBe(true);
    expect(execCalls).toEqual([]);
  });

  it('whitespace-only installCommand is treated as a real command (current behavior: truthy non-empty string passes the `if` check)', async () => {
    const runner = makeShellRunner();
    queueExec({ stdout: 'ok', stderr: '', exitCode: 0 });
    const ctx = makeContext({ taskType: 'REPO_CLONE', payload: { installCommand: '   ' } });

    const result = await runner.execute(ctx);

    expect(execCalls).toHaveLength(1);
    expect(execCalls[0].command).toBe('   ');
    expect(result.success).toBe(true);
  });
});

// ─── Build mode: command composition and exec wiring ───────────────────────

describe('ShellRunner.execute - build mode: command composition and exec wiring', () => {
  it('only installCommand is passed verbatim, cwd and timeout 1200 are exact', async () => {
    const runner = makeShellRunner();
    queueExec({ stdout: 'install done', stderr: '', exitCode: 0 });
    const ctx = makeContext({
      taskType: 'REPO_CLONE',
      refId: 'deploy-1',
      payload: { installCommand: 'pnpm install' },
    });

    const result = await runner.execute(ctx);

    expect(execCalls).toHaveLength(1);
    expect(execCalls[0].command).toBe('pnpm install');
    expect(execCalls[0].options).toEqual({
      cwd: path.join(BUILD_ROOT, 'deploy-1'),
      timeout: 1200,
    });
    expect(result).toEqual({
      success: true,
      stdout: 'install done',
      stderr: '',
      exitCode: 0,
      errorMessage: '',
    });
  });

  it('only buildCommand is passed verbatim', async () => {
    const runner = makeShellRunner();
    queueExec({ stdout: '', stderr: '', exitCode: 0 });
    const ctx = makeContext({ taskType: 'REPO_CLONE', payload: { buildCommand: 'pnpm build' } });

    const result = await runner.execute(ctx);

    expect(execCalls).toHaveLength(1);
    expect(execCalls[0].command).toBe('pnpm build');
    expect(result.success).toBe(true);
  });

  it('install + build are joined with exactly " && " (single space-ampersand-space, no other separators)', async () => {
    const runner = makeShellRunner();
    queueExec({ stdout: '', stderr: '', exitCode: 0 });
    const ctx = makeContext({
      taskType: 'REPO_CLONE',
      payload: { installCommand: 'pnpm install', buildCommand: 'pnpm build' },
    });

    await runner.execute(ctx);

    expect(execCalls).toHaveLength(1);
    expect(execCalls[0].command).toBe('pnpm install && pnpm build');
    expect(execCalls[0].command).toContain(' && ');
    // The current code uses ' && ' (single space ampersand single space) and no ';' or '||'.
    expect(execCalls[0].command).not.toMatch(/&&[^ ]/);
    expect(execCalls[0].command).not.toMatch(/[^ ]&&/);
    expect(execCalls[0].command).not.toContain(';');
    expect(execCalls[0].command).not.toContain('||');
  });

  it('cwd equals path.join(BUILD_ROOT, refId) — verified for arbitrary refId "my-deploy-id"', async () => {
    const runner = makeShellRunner();
    queueExec({ stdout: '', stderr: '', exitCode: 0 });
    const ctx = makeContext({
      taskType: 'REPO_CLONE',
      refId: 'my-deploy-id',
      payload: { installCommand: 'echo hi' },
    });

    await runner.execute(ctx);

    expect(execCalls[0].options.cwd).toBe('/tmp/launchly-builds/my-deploy-id');
  });

  it('timeout is exactly 1200 (not 1200*1000, not the default 300)', async () => {
    const runner = makeShellRunner();
    queueExec({ stdout: '', stderr: '', exitCode: 0 });
    const ctx = makeContext({ taskType: 'REPO_CLONE', payload: { installCommand: 'echo hi' } });

    await runner.execute(ctx);

    expect(execCalls[0].options.timeout).toBe(1200);
    expect(execCalls[0].options.timeout).not.toBe(1200000);
    expect(execCalls[0].options.timeout).not.toBe(300);
  });
});

// ─── Build mode: exit code interpretation ─────────────────────────────────

describe('ShellRunner.execute - build mode: exit code interpretation', () => {
  it('exitCode 0 yields success=true, errorMessage="" and preserves executor stdout/stderr', async () => {
    const runner = makeShellRunner();
    queueExec({ stdout: 'out-line\n', stderr: 'err-line\n', exitCode: 0 });
    const ctx = makeContext({ taskType: 'REPO_CLONE', payload: { installCommand: 'pnpm install' } });

    const result = await runner.execute(ctx);

    expect(result).toEqual({
      success: true,
      stdout: 'out-line\n',
      stderr: 'err-line\n',
      exitCode: 0,
      errorMessage: '',
    });
  });

  it('exitCode 1 yields success=false, errorMessage="Build failed", preserves original stdout/stderr/exitCode', async () => {
    const runner = makeShellRunner();
    queueExec({ stdout: 'partial\n', stderr: 'npm ERR! missing dep\n', exitCode: 1 });
    const ctx = makeContext({ taskType: 'REPO_CLONE', payload: { installCommand: 'pnpm install' } });

    const result = await runner.execute(ctx);

    expect(result).toEqual({
      success: false,
      stdout: 'partial\n',
      stderr: 'npm ERR! missing dep\n',
      exitCode: 1,
      errorMessage: 'Build failed',
    });
  });

  it('exitCode 137 (OOM kill) yields success=false and errorMessage="Build failed"', async () => {
    const runner = makeShellRunner();
    queueExec({ stdout: '', stderr: 'killed', exitCode: 137 });
    const ctx = makeContext({ taskType: 'REPO_CLONE', payload: { buildCommand: 'pnpm build' } });

    const result = await runner.execute(ctx);

    expect(result).toEqual({
      success: false,
      stdout: '',
      stderr: 'killed',
      exitCode: 137,
      errorMessage: 'Build failed',
    });
  });

  it('executor.exec rejection propagates as-is (current behavior: NOT wrapped into RunnerResult)', async () => {
    const runner = makeShellRunner();
    const err = new Error('spawn ENOENT bash');
    queueExec({ throw: err });
    const ctx = makeContext({ taskType: 'REPO_CLONE', payload: { installCommand: 'pnpm install' } });

    await expect(runner.execute(ctx)).rejects.toBe(err);
  });
});

// ─── Build mode: stageLogCallback ──────────────────────────────────────────

describe('ShellRunner.execute - build mode: stageLogCallback', () => {
  it('invokes stageLogCallback with ("RUNNING", "Executing: " + fullCommand) BEFORE executor.exec, exactly once', async () => {
    const runner = makeShellRunner();
    const order: string[] = [];
    const callback = jest.fn(async (status: string, logText: string) => {
      order.push(`cb:${status}:${logText}`);
    });
    const execFn = jest.fn(async (_cmd: string, _opts: any) => {
      order.push('exec');
      return { stdout: '', stderr: '', exitCode: 0 };
    });
    (runner as any).executor = { exec: execFn };
    const ctx = makeContext({
      taskType: 'REPO_CLONE',
      payload: { installCommand: 'pnpm install' },
      stageLogCallback: callback,
    });

    await runner.execute(ctx);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith('RUNNING', 'Executing: pnpm install');
    expect(execFn).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['cb:RUNNING:Executing: pnpm install', 'exec']);
  });

  it('omitting stageLogCallback still runs executor.exec and returns full result', async () => {
    const runner = makeShellRunner();
    queueExec({ stdout: 'out', stderr: '', exitCode: 0 });
    const ctx = makeContext({
      taskType: 'REPO_CLONE',
      payload: { installCommand: 'pnpm install' },
      stageLogCallback: undefined,
    });

    const result = await runner.execute(ctx);

    expect(execCalls).toHaveLength(1);
    expect(execCalls[0].command).toBe('pnpm install');
    expect(result.success).toBe(true);
  });

  it('stageLogCallback rejection short-circuits: executor.exec is NOT called (current behavior)', async () => {
    const runner = makeShellRunner();
    const callback = jest.fn(async () => {
      throw new Error('callback exploded');
    });
    const ctx = makeContext({
      taskType: 'REPO_CLONE',
      payload: { installCommand: 'pnpm install' },
      stageLogCallback: callback,
    });

    await expect(runner.execute(ctx)).rejects.toThrow('callback exploded');
    // No exec call must have happened because the callback threw first
    expect(execCalls).toEqual([]);
  });
});

// ─── Build mode: payload and path edge cases (current behavior) ────────────

describe('ShellRunner.execute - build mode: payload/path edge cases (current behavior)', () => {
  it('command containing a token/secret value is passed verbatim to executor.exec (no escaping, no redaction)', async () => {
    const runner = makeShellRunner();
    queueExec({ stdout: '', stderr: '', exitCode: 0 });
    const secret = 'ghs_TESTSECRET123abcdef';
    const callback = jest.fn(async () => undefined);
    const ctx = makeContext({
      taskType: 'REPO_CLONE',
      payload: { installCommand: `echo $TOKEN=${secret}` },
      stageLogCallback: callback,
    });

    await runner.execute(ctx);

    expect(execCalls[0].command).toBe(`echo $TOKEN=${secret}`);
    expect(execCalls[0].command).toContain(secret);
    expect(callback).toHaveBeenCalledWith(
      'RUNNING',
      `Executing: echo $TOKEN=${secret}`,
    );
  });

  it('command containing quotes/semicolons/backticks is passed verbatim (no shell escaping at this layer)', async () => {
    const runner = makeShellRunner();
    queueExec({ stdout: '', stderr: '', exitCode: 0 });
    const raw = `echo "hi"; rm -rf /tmp/x; \`whoami\` && cat /etc/passwd`;
    const ctx = makeContext({ taskType: 'REPO_CLONE', payload: { buildCommand: raw } });

    await runner.execute(ctx);

    expect(execCalls[0].command).toBe(raw);
  });

  it('executor stdout/stderr containing secrets are returned verbatim (no sanitization at this layer)', async () => {
    const runner = makeShellRunner();
    queueExec({
      stdout: 'connecting with password=hunter2\n',
      stderr: 'token=ghp_abcdefghijklmnopqrstuvwxyz\n',
      exitCode: 0,
    });
    const ctx = makeContext({ taskType: 'REPO_CLONE', payload: { installCommand: 'echo' } });

    const result = await runner.execute(ctx);

    expect(result.stdout).toBe('connecting with password=hunter2\n');
    expect(result.stderr).toBe('token=ghp_abcdefghijklmnopqrstuvwxyz\n');
    expect(result.stdout).toContain('hunter2');
    expect(result.stderr).toContain('ghp_abcdefghijklmnopqrstuvwxyz');
  });

  it('refId containing "../" is normalized by path.join to /tmp/<escaped-segment> (current behavior - KI-032 path traversal)', async () => {
    const runner = makeShellRunner();
    queueExec({ stdout: '', stderr: '', exitCode: 0 });
    const ctx = makeContext({
      taskType: 'REPO_CLONE',
      refId: '../escape-1',
      payload: { installCommand: 'echo hi' },
    });

    await runner.execute(ctx);

    expect(execCalls[0].options.cwd).toBe(path.join(BUILD_ROOT, '../escape-1'));
    expect(execCalls[0].options.cwd).toBe('/tmp/escape-1');
  });

  it('refId starting with "/" is appended (path.join does not treat it as absolute, current behavior)', async () => {
    const runner = makeShellRunner();
    queueExec({ stdout: '', stderr: '', exitCode: 0 });
    const ctx = makeContext({
      taskType: 'REPO_CLONE',
      refId: '/etc/passwd',
      payload: { installCommand: 'echo hi' },
    });

    await runner.execute(ctx);

    // path.join('/tmp/launchly-builds', '/etc/passwd') === '/tmp/launchly-builds/etc/passwd'
    // (path.join only treats the FIRST argument as absolute; subsequent args are joined relative).
    expect(execCalls[0].options.cwd).toBe('/tmp/launchly-builds/etc/passwd');
  });

  it.each([
    ['NUL', '\0'],
    ['CR', '\r'],
    ['LF', '\n'],
  ])(
    'refId containing %s is passed through (no validation in this layer)',
    async (_label, controlCharacter) => {
      const runner = makeShellRunner();
      queueExec({ stdout: '', stderr: '', exitCode: 0 });
      const refId = `has${controlCharacter}control`;
      const ctx = makeContext({
        taskType: 'REPO_CLONE',
        refId,
        payload: { installCommand: 'echo hi' },
      });

      await runner.execute(ctx);

      expect(execCalls[0].options.cwd).toBe(`/tmp/launchly-builds/${refId}`);
    },
  );

  it('payload = null throws TypeError during destructure (current behavior - input contract violation)', async () => {
    const runner = makeShellRunner();
    const ctx = makeContext({ taskType: 'REPO_CLONE', payload: null as any });

    await expect(runner.execute(ctx)).rejects.toBeInstanceOf(TypeError);
    expect(execCalls).toEqual([]);
  });

  it('payload = undefined throws TypeError during destructure (current behavior)', async () => {
    const runner = makeShellRunner();
    const ctx = makeContext({ taskType: 'REPO_CLONE', payload: undefined as any });

    await expect(runner.execute(ctx)).rejects.toBeInstanceOf(TypeError);
    expect(execCalls).toEqual([]);
  });

  it('startCommand, testCommand, healthCheckPath, host, port are ignored in build mode (current behavior)', async () => {
    const runner = makeShellRunner();
    queueExec({ stdout: '', stderr: '', exitCode: 0 });
    const ctx = makeContext({
      taskType: 'REPO_CLONE',
      payload: {
        installCommand: 'pnpm install',
        startCommand: 'pnpm start',
        testCommand: 'pnpm test',
        healthCheckPath: '/healthz',
        host: 'service.local',
        port: 9999,
      },
    });

    await runner.execute(ctx);

    expect(execCalls).toHaveLength(1);
    expect(execCalls[0].command).toBe('pnpm install');
    expect(execCalls[0].command).not.toContain('pnpm start');
    expect(execCalls[0].command).not.toContain('pnpm test');
    expect(execCalls[0].command).not.toContain('healthz');
    expect(execCalls[0].command).not.toContain('service.local');
  });
});

// ─── HEALTH_CHECK mode: URL and defaults ──────────────────────────────────

describe('ShellRunner.execute - HEALTH_CHECK mode: URL and defaults', () => {
  it.each([
    ['missing', {}],
    ['null', { host: null as any }],
    ['empty', { host: '' }],
  ])(
    'host %s defaults to "localhost" and port to 3000, path to "/"',
    async (_label, payload) => {
      const runner = makeShellRunner();
      queueExec({ stdout: '200', stderr: '', exitCode: 0 });
      const ctx = makeContext({ taskType: 'HEALTH_CHECK', payload });

      const result = await runner.execute(ctx);

      expect(result.success).toBe(true);
      expect(execCalls[0].command).toBe(
        'curl -sf -o /dev/null -w "%{http_code}" "http://localhost:3000/"',
      );
    },
  );

  it('uses port 3000 when port is missing', async () => {
    const runner = makeShellRunner();
    queueExec({ stdout: '200', stderr: '', exitCode: 0 });
    const ctx = makeContext({ taskType: 'HEALTH_CHECK', payload: { host: 'myhost' } });

    await runner.execute(ctx);

    expect(execCalls[0].command).toContain('"http://myhost:3000/"');
  });

  it('healthPort wins over port when both are provided', async () => {
    const runner = makeShellRunner();
    queueExec({ stdout: '200', stderr: '', exitCode: 0 });
    const ctx = makeContext({
      taskType: 'HEALTH_CHECK',
      payload: { host: 'myhost', port: 8080, healthPort: 9090 },
    });

    await runner.execute(ctx);

    expect(execCalls[0].command).toContain('"http://myhost:9090/"');
    expect(execCalls[0].command).not.toContain(':8080/');
  });

  it('healthPort inherits port when healthPort is missing', async () => {
    const runner = makeShellRunner();
    queueExec({ stdout: '200', stderr: '', exitCode: 0 });
    const ctx = makeContext({
      taskType: 'HEALTH_CHECK',
      payload: { host: 'myhost', port: 8080 },
    });

    await runner.execute(ctx);

    expect(execCalls[0].command).toContain('"http://myhost:8080/"');
  });

  it.each([
    ['missing', {}],
    ['empty', { healthCheckPath: '' }],
  ])('healthCheckPath %s defaults to "/"', async (_label, pathPayload) => {
    const runner = makeShellRunner();
    queueExec({ stdout: '200', stderr: '', exitCode: 0 });
    const ctx = makeContext({
      taskType: 'HEALTH_CHECK',
      payload: { host: 'h', ...pathPayload },
    });

    await runner.execute(ctx);

    expect(execCalls[0].command).toBe(
      'curl -sf -o /dev/null -w "%{http_code}" "http://h:3000/"',
    );
  });

  it('healthCheckPath is used verbatim when provided (no transformation)', async () => {
    const runner = makeShellRunner();
    queueExec({ stdout: '200', stderr: '', exitCode: 0 });
    const ctx = makeContext({
      taskType: 'HEALTH_CHECK',
      payload: { host: 'h', healthCheckPath: '/api/health/v2' },
    });

    await runner.execute(ctx);

    expect(execCalls[0].command).toContain('"http://h:3000/api/health/v2"');
  });
});

// ─── HEALTH_CHECK mode: curl command exact format ──────────────────────────

describe('ShellRunner.execute - HEALTH_CHECK mode: curl command exact format', () => {
  it('emits exactly `curl -sf -o /dev/null -w "%{http_code}" "<url>"` with no extra flags', async () => {
    const runner = makeShellRunner();
    queueExec({ stdout: '200', stderr: '', exitCode: 0 });
    const ctx = makeContext({
      taskType: 'HEALTH_CHECK',
      payload: { host: 'example.com', healthCheckPath: '/health' },
    });

    await runner.execute(ctx);

    expect(execCalls[0].command).toBe(
      'curl -sf -o /dev/null -w "%{http_code}" "http://example.com:3000/health"',
    );
  });

  it('options contains exactly { timeout: 30 } (no cwd, no env)', async () => {
    const runner = makeShellRunner();
    queueExec({ stdout: '200', stderr: '', exitCode: 0 });
    const ctx = makeContext({ taskType: 'HEALTH_CHECK', payload: { host: 'h' } });

    await runner.execute(ctx);

    expect(execCalls[0].options).toEqual({ timeout: 30 });
    expect(execCalls[0].options.cwd).toBeUndefined();
    expect(execCalls[0].options.env).toBeUndefined();
  });

  it('timeout is exactly 30 (not 30*1000, not 300)', async () => {
    const runner = makeShellRunner();
    queueExec({ stdout: '200', stderr: '', exitCode: 0 });
    const ctx = makeContext({ taskType: 'HEALTH_CHECK', payload: { host: 'h' } });

    await runner.execute(ctx);

    expect(execCalls[0].options.timeout).toBe(30);
    expect(execCalls[0].options.timeout).not.toBe(30000);
    expect(execCalls[0].options.timeout).not.toBe(300);
  });
});

// ─── HEALTH_CHECK mode: status code interpretation ─────────────────────────

describe('ShellRunner.execute - HEALTH_CHECK mode: status code interpretation', () => {
  it.each([200, 201, 204, 301, 302, 399])(
    'treats %i as success with full result deep-equal ("Health check passed (<code>)")',
    async (code) => {
      const runner = makeShellRunner();
      queueExec({ stdout: String(code), stderr: '', exitCode: 0 });
      const ctx = makeContext({ taskType: 'HEALTH_CHECK', payload: { host: 'h' } });

      const result = await runner.execute(ctx);

      expect(result).toEqual({
        success: true,
        stdout: `Health check passed (${code})`,
        stderr: '',
        exitCode: 0,
        errorMessage: '',
      });
      expect(execCalls).toHaveLength(1);
    },
  );

  it('199 (just below the success range) is treated as failure and retried', async () => {
    const runner = makeShellRunner();
    queueExec({ stdout: '199', stderr: '', exitCode: 0 });
    for (let i = 0; i < 9; i++) {
      queueExec({ stdout: '500', stderr: '', exitCode: 0 });
    }
    const ctx = makeContext({ taskType: 'HEALTH_CHECK', payload: { host: 'h' } });

    const promise = runner.execute(ctx);
    await drainTimeouts();
    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('Health check failed');
    expect(execCalls).toHaveLength(10);
  });

  it('400 (just above the success range) is treated as failure and retried', async () => {
    const runner = makeShellRunner();
    queueExec({ stdout: '400', stderr: '', exitCode: 0 });
    for (let i = 0; i < 9; i++) {
      queueExec({ stdout: '500', stderr: '', exitCode: 0 });
    }
    const ctx = makeContext({ taskType: 'HEALTH_CHECK', payload: { host: 'h' } });

    const promise = runner.execute(ctx);
    await drainTimeouts();
    const result = await promise;

    expect(result.success).toBe(false);
    expect(execCalls).toHaveLength(10);
  });

  it('trims leading/trailing whitespace on stdout before parseInt', async () => {
    const runner = makeShellRunner();
    queueExec({ stdout: '   200   \n', stderr: '', exitCode: 0 });
    const ctx = makeContext({ taskType: 'HEALTH_CHECK', payload: { host: 'h' } });

    const result = await runner.execute(ctx);

    expect(result.success).toBe(true);
    expect(result.stdout).toBe('Health check passed (200)');
  });

  it('"200abc" is parsed as 200 by parseInt (current behavior: stops at first non-digit) and treated as success', async () => {
    const runner = makeShellRunner();
    queueExec({ stdout: '200abc', stderr: '', exitCode: 0 });
    const ctx = makeContext({ taskType: 'HEALTH_CHECK', payload: { host: 'h' } });

    const result = await runner.execute(ctx);

    expect(result.success).toBe(true);
    expect(result.stdout).toBe('Health check passed (200)');
  });

  it('empty stdout is treated as failure (parseInt("") === NaN) and the loop retries', async () => {
    const runner = makeShellRunner();
    for (let i = 0; i < 10; i++) {
      queueExec({ stdout: '', stderr: '', exitCode: 0 });
    }
    const ctx = makeContext({ taskType: 'HEALTH_CHECK', payload: { host: 'h' } });

    const promise = runner.execute(ctx);
    await drainTimeouts();
    const result = await promise;

    expect(result.success).toBe(false);
    expect(execCalls).toHaveLength(10);
  });

  it('unparseable stdout "abc" is treated as failure (parseInt === NaN) and the loop retries', async () => {
    const runner = makeShellRunner();
    for (let i = 0; i < 10; i++) {
      queueExec({ stdout: 'abc', stderr: '', exitCode: 0 });
    }
    const ctx = makeContext({ taskType: 'HEALTH_CHECK', payload: { host: 'h' } });

    const promise = runner.execute(ctx);
    await drainTimeouts();
    const result = await promise;

    expect(result.success).toBe(false);
    expect(execCalls).toHaveLength(10);
  });

  it('non-zero exitCode with stdout "200" still counts as success (current behavior: only stdout is parsed)', async () => {
    const runner = makeShellRunner();
    queueExec({ stdout: '200', stderr: 'something', exitCode: 1 });
    const ctx = makeContext({ taskType: 'HEALTH_CHECK', payload: { host: 'h' } });

    const result = await runner.execute(ctx);

    expect(result.success).toBe(true);
    expect(execCalls).toHaveLength(1);
  });
});

// ─── HEALTH_CHECK mode: error handling and retry ──────────────────────────

describe('ShellRunner.execute - HEALTH_CHECK mode: error handling and retry', () => {
  it('executor.exec throws are swallowed by `catch {}` and the loop continues (does not reject)', async () => {
    const runner = makeShellRunner();
    queueExec({ throw: new Error('spawn ENOENT') });
    for (let i = 0; i < 9; i++) {
      queueExec({ stdout: '500', stderr: '', exitCode: 0 });
    }
    const ctx = makeContext({ taskType: 'HEALTH_CHECK', payload: { host: 'h' } });

    const promise = runner.execute(ctx);
    await drainTimeouts();
    const result = await promise;

    expect(result.success).toBe(false);
    expect(execCalls).toHaveLength(10);
  });

  it('first 3 fail (500), 4th succeeds (200): exactly 4 exec calls and 3 waits of 5000ms', async () => {
    const runner = makeShellRunner();
    for (let i = 0; i < 3; i++) {
      queueExec({ stdout: '500', stderr: '', exitCode: 0 });
    }
    queueExec({ stdout: '200', stderr: '', exitCode: 0 });
    const ctx = makeContext({ taskType: 'HEALTH_CHECK', payload: { host: 'h' } });

    const promise = runner.execute(ctx);
    const observedWaits = await drainTimeouts();
    const result = await promise;

    expect(execCalls).toHaveLength(4);
    expect(observedWaits).toEqual([5000, 5000, 5000]);
    expect(result).toEqual({
      success: true,
      stdout: 'Health check passed (200)',
      stderr: '',
      exitCode: 0,
      errorMessage: '',
    });
  });

  it('all 10 attempts fail: 10 exec calls, 10 waits (current behavior: 10th attempt still triggers a 5000ms wait)', async () => {
    const runner = makeShellRunner();
    for (let i = 0; i < 10; i++) {
      queueExec({ stdout: '500', stderr: 'upstream down', exitCode: 0 });
    }
    const ctx = makeContext({ taskType: 'HEALTH_CHECK', payload: { host: 'h' } });

    const promise = runner.execute(ctx);
    const observedWaits = await drainTimeouts();
    const result = await promise;

    expect(execCalls).toHaveLength(10);
    expect(observedWaits).toHaveLength(10);
    for (const ms of observedWaits) {
      expect(ms).toBe(5000);
    }
    expect(result).toEqual({
      success: false,
      stdout: '',
      stderr: 'Health check failed after 10 attempts',
      exitCode: 1,
      errorMessage: 'Health check failed',
    });
  });

  it('after success on the first attempt: zero setTimeout waits (no 5000ms wait when first succeeds)', async () => {
    const runner = makeShellRunner();
    queueExec({ stdout: '200', stderr: '', exitCode: 0 });
    const ctx = makeContext({ taskType: 'HEALTH_CHECK', payload: { host: 'h' } });

    const promise = runner.execute(ctx);
    await drainTimeouts();
    const result = await promise;

    expect(execCalls).toHaveLength(1);
    expect(allTimeoutMs()).toEqual([]);
    expect(result.success).toBe(true);
  });
});

// ─── HEALTH_CHECK mode: stageLogCallback ──────────────────────────────────

describe('ShellRunner.execute - HEALTH_CHECK mode: stageLogCallback', () => {
  it('invokes stageLogCallback with ("RUNNING", "Health check: <url>") BEFORE first exec', async () => {
    const runner = makeShellRunner();
    const order: string[] = [];
    const callback = jest.fn(async (status: string, logText: string) => {
      order.push(`cb:${status}:${logText}`);
    });
    const execFn = jest.fn(async (_cmd: string, _opts: any) => {
      order.push('exec');
      return { stdout: '200', stderr: '', exitCode: 0 };
    });
    (runner as any).executor = { exec: execFn };
    const ctx = makeContext({
      taskType: 'HEALTH_CHECK',
      payload: { host: 'my-service', healthCheckPath: '/health' },
      stageLogCallback: callback,
    });

    await runner.execute(ctx);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(
      'RUNNING',
      'Health check: http://my-service:3000/health',
    );
    expect(execFn).toHaveBeenCalledTimes(1);
    expect(order).toEqual([
      'cb:RUNNING:Health check: http://my-service:3000/health',
      'exec',
    ]);
  });

  it('omitting stageLogCallback still runs executor.exec', async () => {
    const runner = makeShellRunner();
    queueExec({ stdout: '200', stderr: '', exitCode: 0 });
    const ctx = makeContext({
      taskType: 'HEALTH_CHECK',
      payload: { host: 'h' },
      stageLogCallback: undefined,
    });

    const result = await runner.execute(ctx);

    expect(execCalls).toHaveLength(1);
    expect(result.success).toBe(true);
  });

  it('stageLogCallback rejection short-circuits: executor.exec is NOT called (current behavior)', async () => {
    const runner = makeShellRunner();
    const callback = jest.fn(async () => {
      throw new Error('callback down');
    });
    const ctx = makeContext({
      taskType: 'HEALTH_CHECK',
      payload: { host: 'h' },
      stageLogCallback: callback,
    });

    await expect(runner.execute(ctx)).rejects.toThrow('callback down');
    expect(execCalls).toEqual([]);
  });
});

// ─── HEALTH_CHECK mode: port/host edge cases (current behavior) ──────────

describe('ShellRunner.execute - HEALTH_CHECK mode: port and host edge cases (current behavior)', () => {
  it('port 0 produces URL with literal ":0" (current behavior: no range check)', async () => {
    const runner = makeShellRunner();
    queueExec({ stdout: '200', stderr: '', exitCode: 0 });
    const ctx = makeContext({ taskType: 'HEALTH_CHECK', payload: { host: 'h', port: 0 } });

    await runner.execute(ctx);

    expect(execCalls[0].command).toContain('"http://h:0/"');
  });

  it('port 65536 produces URL with literal ":65536" (current behavior: no range check)', async () => {
    const runner = makeShellRunner();
    queueExec({ stdout: '200', stderr: '', exitCode: 0 });
    const ctx = makeContext({ taskType: 'HEALTH_CHECK', payload: { host: 'h', port: 65536 } });

    await runner.execute(ctx);

    expect(execCalls[0].command).toContain('"http://h:65536/"');
  });

  it('negative port produces URL with literal negative number (current behavior)', async () => {
    const runner = makeShellRunner();
    queueExec({ stdout: '200', stderr: '', exitCode: 0 });
    const ctx = makeContext({ taskType: 'HEALTH_CHECK', payload: { host: 'h', port: -1 } });

    await runner.execute(ctx);

    expect(execCalls[0].command).toContain('"http://h:-1/"');
  });

  it('port as string "8080" produces URL with literal "8080" (current behavior: passed verbatim, no coercion)', async () => {
    const runner = makeShellRunner();
    queueExec({ stdout: '200', stderr: '', exitCode: 0 });
    const ctx = makeContext({
      taskType: 'HEALTH_CHECK',
      payload: { host: 'h', port: '8080' as any },
    });

    await runner.execute(ctx);

    expect(execCalls[0].command).toContain('"http://h:8080/"');
  });

  it('NaN port produces a literal "NaN" URL segment (current behavior: no numeric validation)', async () => {
    const runner = makeShellRunner();
    queueExec({ stdout: '200', stderr: '', exitCode: 0 });
    const ctx = makeContext({
      taskType: 'HEALTH_CHECK',
      payload: { host: 'h', port: Number.NaN },
    });

    await runner.execute(ctx);

    expect(execCalls[0].command).toContain('"http://h:NaN/"');
  });

  it.each([
    [
      'host',
      { host: 'host"; echo HOST_INJECTION\n#' },
      'http://host"; echo HOST_INJECTION\n#:3000/',
    ],
    [
      'health path',
      { host: 'safe-host', healthCheckPath: '/"; echo PATH_INJECTION\n#' },
      'http://safe-host:3000/"; echo PATH_INJECTION\n#',
    ],
  ])(
    '%s containing quotes, semicolons, and a newline is interpolated verbatim into the curl command (current behavior)',
    async (_label, payload, expectedUrl) => {
      const runner = makeShellRunner();
      queueExec({ stdout: '200', stderr: '', exitCode: 0 });
      const ctx = makeContext({ taskType: 'HEALTH_CHECK', payload });

      await runner.execute(ctx);

      expect(execCalls[0].command).toBe(
        `curl -sf -o /dev/null -w "%{http_code}" "${expectedUrl}"`,
      );
    },
  );
});

// ─── HEALTH_CHECK mode: full result shape ─────────────────────────────────

describe('ShellRunner.execute - HEALTH_CHECK mode: full RunnerResult shape', () => {
  it('success result: exact { success: true, stdout: "Health check passed (200)", stderr: "", exitCode: 0, errorMessage: "" }', async () => {
    const runner = makeShellRunner();
    queueExec({ stdout: '200', stderr: '', exitCode: 0 });
    const ctx = makeContext({ taskType: 'HEALTH_CHECK', payload: { host: 'h' } });

    const result = await runner.execute(ctx);

    expect(result).toEqual({
      success: true,
      stdout: 'Health check passed (200)',
      stderr: '',
      exitCode: 0,
      errorMessage: '',
    });
  });

  it('failure result after 10 attempts: exact { success: false, stdout: "", stderr: "Health check failed after 10 attempts", exitCode: 1, errorMessage: "Health check failed" }', async () => {
    const runner = makeShellRunner();
    for (let i = 0; i < 10; i++) {
      queueExec({ stdout: '500', stderr: 'upstream down', exitCode: 0 });
    }
    const ctx = makeContext({ taskType: 'HEALTH_CHECK', payload: { host: 'h' } });

    const promise = runner.execute(ctx);
    await drainTimeouts();
    const result = await promise;

    expect(result).toEqual({
      success: false,
      stdout: '',
      stderr: 'Health check failed after 10 attempts',
      exitCode: 1,
      errorMessage: 'Health check failed',
    });
  });
});

// ─── Mock strictness ──────────────────────────────────────────────────────

describe('ShellRunner executor mock - default-strict behavior', () => {
  it('default-impl (unconfigured call) throws with explicit message naming the command (sanity check)', async () => {
    const executor = makeExecutor();
    await expect(executor.exec('whoami', {})).rejects.toThrow(
      'Unexpected unconfigured exec call: whoami',
    );
  });

  it('only one queued result is consumed per exec call (queue draining is exact, not sticky)', async () => {
    const executor = makeExecutor();
    executor['execResults' as any] = undefined; // intentionally no-op
    // The mock is shared via the closure, so we re-create by direct call
    execResults.push({ stdout: 'a', stderr: '', exitCode: 0 });
    execResults.push({ stdout: 'b', stderr: '', exitCode: 0 });

    const r1 = await executor.exec('first', {});
    const r2 = await executor.exec('second', {});

    expect(r1.stdout).toBe('a');
    expect(r2.stdout).toBe('b');
    // Third call with empty queue must throw
    await expect(executor.exec('third', {})).rejects.toThrow(
      'Unexpected unconfigured exec call: third',
    );
  });
});
