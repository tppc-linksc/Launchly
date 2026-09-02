/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ─── child_process.execFileSync mock (queue + strict default) ─────────────
// KI-041 修复后，CLI 全部使用 execFileSync 接收参数数组。
// mock 接受 (file, args, options) 三个参数并按 args 数组内容匹配 plan。

interface ExecResult {
  file?: string;
  args?: string[];
  options?: any;
  stdout?: string;
  stderr?: string;
  throw?: Error;
}

interface ExecCall {
  file: string;
  args: string[];
  options: any;
}

let execCalls: ExecCall[] = [];
let execQueue: ExecResult[] = [];
let unconfiguredCallCount = 0;
let unexpectedExitCalls: Array<number | undefined> = [];

function argsEqual(a: string[], b: string[] | undefined): boolean {
  if (!b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

vi.mock('child_process', () => ({
  execFileSync: vi.fn((file: string, args: string[], options: any) => {
    execCalls.push({ file, args, options });
    if (execQueue.length === 0) {
      unconfiguredCallCount++;
      throw new Error(`Unexpected unconfigured execFileSync call: ${file} ${JSON.stringify(args)}`);
    }
    const r = execQueue.shift()!;
    if (r.file !== undefined && r.file !== file) {
      throw new Error(`execFileSync file mismatch: expected ${JSON.stringify(r.file)}, got ${JSON.stringify(file)}`);
    }
    if (r.args !== undefined && !argsEqual(args, r.args)) {
      throw new Error(`execFileSync args mismatch: expected ${JSON.stringify(r.args)}, got ${JSON.stringify(args)}`);
    }
    if (r.throw) throw r.throw;
    return r.stdout ?? '';
  }),
}));

function queueExec(r: ExecResult): void {
  execQueue.push(r);
}

const cp = await import('child_process');
const execFileSyncMock = cp.execFileSync as unknown as ReturnType<typeof vi.fn>;

// ─── Test fixture setup / teardown ────────────────────────────────────────

let tmpRoot: string;
let dataDir: string;
let originalArgv: string[];
let originalDataDirEnv: string | undefined;
let consoleSpy: ReturnType<typeof vi.spyOn>;
let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;
let stderrWriteSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;
let capturedConsoleOutput: string[] = [];

function captureLog(): string {
  return capturedConsoleOutput.join('\n');
}

beforeEach(() => {
  execCalls = [];
  execQueue = [];
  unconfiguredCallCount = 0;
  unexpectedExitCalls = [];
  execFileSyncMock.mockClear();
  capturedConsoleOutput = [];

  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'launchly-cli-test-'));
  dataDir = path.join(tmpRoot, 'data');

  originalArgv = process.argv;
  originalDataDirEnv = process.env.LAUNCHLY_DATA_DIR;
  process.env.LAUNCHLY_DATA_DIR = dataDir;

  consoleSpy = vi.spyOn(console, 'log').mockImplementation((...args: any[]) => {
    capturedConsoleOutput.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
    return undefined;
  });
  stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as any);
  stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as any);
  exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    unexpectedExitCalls.push(code);
    throw new Error(`Unexpected process.exit(${code})`);
  }) as any);
});

afterEach(() => {
  const strictErrors: string[] = [];
  if (unconfiguredCallCount > 0) {
    strictErrors.push(
      `Test ended with ${unconfiguredCallCount} unconfigured execFileSync call(s) (mock default impl was triggered; production code called execFileSync without the test queuing a result)`,
    );
  }
  if (execQueue.length !== 0) {
    strictErrors.push(
      `Test ended with ${execQueue.length} unconsumed execFileSync result(s); queue must be exactly empty`,
    );
  }
  if (unexpectedExitCalls.length > 0) {
    strictErrors.push(
      `Test ended with ${unexpectedExitCalls.length} unexpected process.exit call(s): ${unexpectedExitCalls.join(', ')}`,
    );
  }

  process.argv = originalArgv;
  if (originalDataDirEnv === undefined) delete process.env.LAUNCHLY_DATA_DIR;
  else process.env.LAUNCHLY_DATA_DIR = originalDataDirEnv;

  consoleSpy.mockRestore();
  stdoutWriteSpy.mockRestore();
  stderrWriteSpy.mockRestore();
  exitSpy.mockRestore();

  vi.resetModules();

  if (tmpRoot) {
    const real = fs.realpathSync(tmpRoot);
    const tmpBase = fs.realpathSync(os.tmpdir());
    if (real.startsWith(tmpBase + path.sep) || real === tmpBase) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } else {
      throw new Error(`Test tmpRoot escaped os.tmpdir(): ${real}`);
    }
  }

  if (strictErrors.length > 0) throw new Error(strictErrors.join('\n'));
});

async function runCli(argv: string[]): Promise<void> {
  process.argv = ['node', 'launchly', ...argv];
  vi.resetModules();
  await import('../index.js');
}

// ─── A. install --dry-run ─────────────────────────────────────────────────

describe('CLI install --dry-run', () => {
  it('default port: outputs plan, no fs writes, no execFileSync, includes data dir and URL', async () => {
    await runCli(['install', '--dry-run']);

    expect(execCalls).toHaveLength(0);
    expect(fs.existsSync(dataDir)).toBe(false);
    expect(fs.existsSync(path.join(dataDir, '.env'))).toBe(false);
    expect(fs.existsSync(path.join(dataDir, 'docker-compose.yml'))).toBe(false);

    const log = captureLog();
    expect(log).toContain('=== Launchly Install (Dry Run) ===');
    expect(log).toContain(`创建数据目录：${dataDir}`);
    expect(log).toContain('http://localhost:8080/setup');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('custom port: --port 9090 is reflected in setup URL and plan', async () => {
    await runCli(['install', '--dry-run', '--port', '9090']);

    expect(execCalls).toHaveLength(0);
    expect(fs.existsSync(dataDir)).toBe(false);

    const log = captureLog();
    expect(log).toContain(`创建数据目录：${dataDir}`);
    expect(log).toContain('http://localhost:9090/setup');
    expect(log).not.toContain('http://localhost:8080/setup');
  });
});

// ─── B. first-time install ────────────────────────────────────────────────

describe('CLI install (first time)', () => {
  it('creates data root + logs/data/config subdirs, .env (mode 0o600) with secrets, compose.yml, single docker command', async () => {
    queueExec({
      file: 'docker',
      args: [
        'compose',
        '-f',
        path.join(dataDir, 'docker-compose.yml'),
        '--env-file',
        path.join(dataDir, '.env'),
        'up',
        '-d',
      ],
    });
    await runCli(['install']);

    expect(fs.existsSync(dataDir)).toBe(true);
    expect(fs.statSync(dataDir).isDirectory()).toBe(true);
    expect(fs.existsSync(path.join(dataDir, 'logs'))).toBe(true);
    expect(fs.existsSync(path.join(dataDir, 'data'))).toBe(true);
    expect(fs.existsSync(path.join(dataDir, 'config'))).toBe(true);
    expect(fs.statSync(path.join(dataDir, 'logs')).isDirectory()).toBe(true);
    expect(fs.statSync(path.join(dataDir, 'data')).isDirectory()).toBe(true);
    expect(fs.statSync(path.join(dataDir, 'config')).isDirectory()).toBe(true);

    const envPath = path.join(dataDir, '.env');
    expect(fs.existsSync(envPath)).toBe(true);
    const envStat = fs.statSync(envPath);
    expect(envStat.mode & 0o777).toBe(0o600);

    const envContent = fs.readFileSync(envPath, 'utf-8');
    expect(envContent).toMatch(/^LAUNCHLY_DB_PASSWORD=[A-Za-z0-9_-]{24}$/m);
    expect(envContent).toMatch(/^LAUNCHLY_JWT_SECRET=[A-Za-z0-9_-]{32}$/m);
    expect(envContent).toMatch(/^LAUNCHLY_ENCRYPTION_KEY=[A-Za-z0-9_-]{32}$/m);
    expect(envContent).toContain('LAUNCHLY_APP_IMAGE=ghcr.io/tppc-linksc/launchly:latest');
    expect(envContent).toContain('LAUNCHLY_APP_PORT=8080');
    expect(envContent).toContain('COMPOSE_PROFILES=');

    const dbPwd = envContent.match(/^LAUNCHLY_DB_PASSWORD=(\S+)$/m)![1];
    const jwt = envContent.match(/^LAUNCHLY_JWT_SECRET=(\S+)$/m)![1];
    const encKey = envContent.match(/^LAUNCHLY_ENCRYPTION_KEY=(\S+)$/m)![1];
    expect(dbPwd.length).toBeGreaterThan(0);
    expect(jwt.length).toBeGreaterThan(0);
    expect(encKey.length).toBeGreaterThan(0);

    const { composeTemplate } = await import('../config.js');
    const composePath = path.join(dataDir, 'docker-compose.yml');
    expect(fs.existsSync(composePath)).toBe(true);
    expect(fs.readFileSync(composePath, 'utf-8')).toBe(composeTemplate());

    expect(execCalls).toHaveLength(1);
    expect(execCalls[0].file).toBe('docker');
    expect(execCalls[0].args).toEqual([
      'compose',
      '-f',
      path.join(dataDir, 'docker-compose.yml'),
      '--env-file',
      path.join(dataDir, '.env'),
      'up',
      '-d',
    ]);
    expect(execCalls[0].options).toEqual({ stdio: 'inherit' });

    const log = captureLog();
    expect(log).toContain('=== Launchly Install ===');
    expect(log).toContain('安装完成。');
    expect(log).toContain('http://localhost:8080/setup');
    expect(log).toContain('创建所有者账号');
  });

  it('custom port --port 3000 is written into .env and completion output', async () => {
    queueExec({
      file: 'docker',
      args: [
        'compose',
        '-f',
        path.join(dataDir, 'docker-compose.yml'),
        '--env-file',
        path.join(dataDir, '.env'),
        'up',
        '-d',
      ],
    });
    await runCli(['install', '--port', '3000']);

    const envContent = fs.readFileSync(path.join(dataDir, '.env'), 'utf-8');
    expect(envContent).toContain('LAUNCHLY_APP_PORT=3000');

    const envPath = path.join(dataDir, '.env');
    const composePath = path.join(dataDir, 'docker-compose.yml');
    expect(execCalls).toHaveLength(1);
    expect(execCalls[0].args).toEqual(['compose', '-f', composePath, '--env-file', envPath, 'up', '-d']);
    expect(execCalls[0].options).toEqual({ stdio: 'inherit' });

    const log = captureLog();
    expect(log).toContain('http://localhost:3000/setup');
    expect(log).not.toContain('http://localhost:8080/setup');
  });
});

// ─── C. repeated install ──────────────────────────────────────────────────

describe('CLI install (repeated)', () => {
  it('pre-existing .env bytes are preserved exactly; compose.yml is rewritten; only one docker command; output mentions skipping', async () => {
    fs.mkdirSync(dataDir, { recursive: true });
    const envPath = path.join(dataDir, '.env');
    const fixedEnv =
      '# frozen\nLAUNCHLY_DB_PASSWORD=FROZEN_DB\nLAUNCHLY_JWT_SECRET=FROZEN_JWT\nLAUNCHLY_ENCRYPTION_KEY=FROZEN_KEY\nLAUNCHLY_APP_IMAGE=ghcr.io/tppc-linksc/launchly:latest\nLAUNCHLY_APP_PORT=8080\nCOMPOSE_PROFILES=\n';
    fs.writeFileSync(envPath, fixedEnv, { mode: 0o600 });

    queueExec({
      file: 'docker',
      args: ['compose', '-f', path.join(dataDir, 'docker-compose.yml'), '--env-file', envPath, 'up', '-d'],
    });
    await runCli(['install']);

    const envAfter = fs.readFileSync(envPath, 'utf-8');
    expect(envAfter).toBe(fixedEnv);

    const { composeTemplate } = await import('../config.js');
    expect(fs.readFileSync(path.join(dataDir, 'docker-compose.yml'), 'utf-8')).toBe(composeTemplate());

    expect(execCalls).toHaveLength(1);
    expect(execCalls[0].args).toEqual([
      'compose',
      '-f',
      path.join(dataDir, 'docker-compose.yml'),
      '--env-file',
      envPath,
      'up',
      '-d',
    ]);
    expect(execCalls[0].options).toEqual({ stdio: 'inherit' });

    const log = captureLog();
    expect(log).toContain('.env 已存在');
    expect(log).toContain('跳过');
  });
});

// ─── D. up / down / restart ──────────────────────────────────────────────

describe('CLI up', () => {
  it('with .env present: docker compose ... --env-file ... up -d, { stdio: inherit }', async () => {
    fs.mkdirSync(dataDir, { recursive: true });
    const envPath = path.join(dataDir, '.env');
    fs.writeFileSync(envPath, 'LAUNCHLY_DB_PASSWORD=x\n', { mode: 0o600 });
    const composePath = path.join(dataDir, 'docker-compose.yml');
    fs.writeFileSync(composePath, 'services: {}\n');

    queueExec({
      file: 'docker',
      args: ['compose', '-f', composePath, '--env-file', envPath, 'up', '-d'],
    });
    await runCli(['up']);

    expect(execCalls).toHaveLength(1);
    expect(execCalls[0].args).toEqual(['compose', '-f', composePath, '--env-file', envPath, 'up', '-d']);
    expect(execCalls[0].options).toEqual({ stdio: 'inherit' });
    const log = captureLog();
    expect(log).toContain('启动 Launchly 服务');
    expect(log).toContain('服务已启动。');
  });

  it('without .env: docker compose ... up -d (no --env-file flag)', async () => {
    fs.mkdirSync(dataDir, { recursive: true });
    const composePath = path.join(dataDir, 'docker-compose.yml');
    fs.writeFileSync(composePath, 'services: {}\n');

    queueExec({
      file: 'docker',
      args: ['compose', '-f', composePath, 'up', '-d'],
    });
    await runCli(['up']);

    expect(execCalls).toHaveLength(1);
    expect(execCalls[0].args).toEqual(['compose', '-f', composePath, 'up', '-d']);
    expect(execCalls[0].args).not.toContain('--env-file');
    expect(execCalls[0].options).toEqual({ stdio: 'inherit' });
  });

  it('propagates an execFileSync failure and does not print a false success', async () => {
    fs.mkdirSync(dataDir, { recursive: true });
    const composePath = path.join(dataDir, 'docker-compose.yml');
    fs.writeFileSync(composePath, 'services: {}\n');
    const failure = new Error('docker compose up failed');
    queueExec({
      file: 'docker',
      args: ['compose', '-f', composePath, 'up', '-d'],
      throw: failure,
    });

    await expect(runCli(['up'])).rejects.toBe(failure);

    expect(execCalls).toEqual([
      {
        file: 'docker',
        args: ['compose', '-f', composePath, 'up', '-d'],
        options: { stdio: 'inherit' },
      },
    ]);
    expect(captureLog()).not.toContain('服务已启动。');
  });
});

describe('CLI down', () => {
  it('with .env: docker compose ... --env-file ... down', async () => {
    fs.mkdirSync(dataDir, { recursive: true });
    const envPath = path.join(dataDir, '.env');
    fs.writeFileSync(envPath, 'LAUNCHLY_DB_PASSWORD=x\n', { mode: 0o600 });
    const composePath = path.join(dataDir, 'docker-compose.yml');
    fs.writeFileSync(composePath, 'services: {}\n');

    queueExec({
      file: 'docker',
      args: ['compose', '-f', composePath, '--env-file', envPath, 'down'],
    });
    await runCli(['down']);

    expect(execCalls).toHaveLength(1);
    expect(execCalls[0].args).toEqual(['compose', '-f', composePath, '--env-file', envPath, 'down']);
    expect(execCalls[0].options).toEqual({ stdio: 'inherit' });
    const log = captureLog();
    expect(log).toContain('停止 Launchly 服务');
    expect(log).toContain('服务已停止。');
  });
});

describe('CLI restart', () => {
  it('with .env: docker compose ... --env-file ... restart', async () => {
    fs.mkdirSync(dataDir, { recursive: true });
    const envPath = path.join(dataDir, '.env');
    fs.writeFileSync(envPath, 'LAUNCHLY_DB_PASSWORD=x\n', { mode: 0o600 });
    const composePath = path.join(dataDir, 'docker-compose.yml');
    fs.writeFileSync(composePath, 'services: {}\n');

    queueExec({
      file: 'docker',
      args: ['compose', '-f', composePath, '--env-file', envPath, 'restart'],
    });
    await runCli(['restart']);

    expect(execCalls).toHaveLength(1);
    expect(execCalls[0].args).toEqual(['compose', '-f', composePath, '--env-file', envPath, 'restart']);
    expect(execCalls[0].options).toEqual({ stdio: 'inherit' });
  });
});

// ─── E. status ───────────────────────────────────────────────────────────

describe('CLI status', () => {
  it('success path: docker compose -f <compose> ps, { stdio: inherit }', async () => {
    fs.mkdirSync(dataDir, { recursive: true });
    const composePath = path.join(dataDir, 'docker-compose.yml');
    fs.writeFileSync(composePath, 'services: {}\n');

    queueExec({
      file: 'docker',
      args: ['compose', '-f', composePath, 'ps'],
    });
    await runCli(['status']);

    expect(execCalls).toHaveLength(1);
    expect(execCalls[0].args).toEqual(['compose', '-f', composePath, 'ps']);
    expect(execCalls[0].options).toEqual({ stdio: 'inherit' });
  });

  it('execFileSync failure: catch handles, output install prompt; no process.exit', async () => {
    fs.mkdirSync(dataDir, { recursive: true });
    const composePath = path.join(dataDir, 'docker-compose.yml');
    fs.writeFileSync(composePath, 'services: {}\n');

    queueExec({
      file: 'docker',
      args: ['compose', '-f', composePath, 'ps'],
      throw: new Error('docker not available'),
    });

    await runCli(['status']);

    expect(execCalls).toHaveLength(1);
    expect(execCalls[0].args).toEqual(['compose', '-f', composePath, 'ps']);
    const log = captureLog();
    expect(log).toContain('未找到 Launchly 服务');
    expect(log).toContain('launchly install');
    expect(exitSpy).not.toHaveBeenCalled();
  });
});

// ─── F. logs ──────────────────────────────────────────────────────────────

describe('CLI logs', () => {
  it('default: docker compose ... --env-file ... logs', async () => {
    fs.mkdirSync(dataDir, { recursive: true });
    const envPath = path.join(dataDir, '.env');
    fs.writeFileSync(envPath, 'LAUNCHLY_DB_PASSWORD=x\n', { mode: 0o600 });
    const composePath = path.join(dataDir, 'docker-compose.yml');
    fs.writeFileSync(composePath, 'services: {}\n');

    queueExec({
      file: 'docker',
      args: ['compose', '-f', composePath, '--env-file', envPath, 'logs'],
    });
    await runCli(['logs']);

    expect(execCalls).toHaveLength(1);
    expect(execCalls[0].args).toEqual(['compose', '-f', composePath, '--env-file', envPath, 'logs']);
    expect(execCalls[0].options).toEqual({ stdio: 'inherit' });
  });

  it('--follow: docker compose ... logs -f', async () => {
    fs.mkdirSync(dataDir, { recursive: true });
    const envPath = path.join(dataDir, '.env');
    fs.writeFileSync(envPath, 'LAUNCHLY_DB_PASSWORD=x\n', { mode: 0o600 });
    const composePath = path.join(dataDir, 'docker-compose.yml');
    fs.writeFileSync(composePath, 'services: {}\n');

    queueExec({
      file: 'docker',
      args: ['compose', '-f', composePath, '--env-file', envPath, 'logs', '-f'],
    });
    await runCli(['logs', '--follow']);

    expect(execCalls).toHaveLength(1);
    expect(execCalls[0].args).toEqual(['compose', '-f', composePath, '--env-file', envPath, 'logs', '-f']);
    expect(execCalls[0].options).toEqual({ stdio: 'inherit' });
  });

  it('--service launchly-api: docker compose ... logs launchly-api', async () => {
    fs.mkdirSync(dataDir, { recursive: true });
    const envPath = path.join(dataDir, '.env');
    fs.writeFileSync(envPath, 'LAUNCHLY_DB_PASSWORD=x\n', { mode: 0o600 });
    const composePath = path.join(dataDir, 'docker-compose.yml');
    fs.writeFileSync(composePath, 'services: {}\n');

    queueExec({
      file: 'docker',
      args: ['compose', '-f', composePath, '--env-file', envPath, 'logs', 'launchly-api'],
    });
    await runCli(['logs', '--service', 'launchly-api']);

    expect(execCalls).toHaveLength(1);
    expect(execCalls[0].args).toEqual(['compose', '-f', composePath, '--env-file', envPath, 'logs', 'launchly-api']);
    expect(execCalls[0].options).toEqual({ stdio: 'inherit' });
  });

  it('--follow + --service: docker compose ... logs -f launchly-worker (order: -f before service)', async () => {
    fs.mkdirSync(dataDir, { recursive: true });
    const envPath = path.join(dataDir, '.env');
    fs.writeFileSync(envPath, 'LAUNCHLY_DB_PASSWORD=x\n', { mode: 0o600 });
    const composePath = path.join(dataDir, 'docker-compose.yml');
    fs.writeFileSync(composePath, 'services: {}\n');

    queueExec({
      file: 'docker',
      args: ['compose', '-f', composePath, '--env-file', envPath, 'logs', '-f', 'launchly-worker'],
    });
    await runCli(['logs', '--follow', '--service', 'launchly-worker']);

    expect(execCalls).toHaveLength(1);
    expect(execCalls[0].args).toEqual([
      'compose',
      '-f',
      composePath,
      '--env-file',
      envPath,
      'logs',
      '-f',
      'launchly-worker',
    ]);
    expect(execCalls[0].options).toEqual({ stdio: 'inherit' });
  });
});

// ─── G. upgrade ───────────────────────────────────────────────────────────

describe('CLI upgrade', () => {
  it('executes pull then up -d in order, both with { stdio: inherit }', async () => {
    fs.mkdirSync(dataDir, { recursive: true });
    const envPath = path.join(dataDir, '.env');
    fs.writeFileSync(envPath, 'LAUNCHLY_DB_PASSWORD=x\n', { mode: 0o600 });
    const composePath = path.join(dataDir, 'docker-compose.yml');
    fs.writeFileSync(composePath, 'services: {}\n');

    queueExec({
      file: 'docker',
      args: ['compose', '-f', composePath, '--env-file', envPath, 'pull'],
    });
    queueExec({
      file: 'docker',
      args: ['compose', '-f', composePath, '--env-file', envPath, 'up', '-d'],
    });
    await runCli(['upgrade']);

    expect(execCalls).toHaveLength(2);
    expect(execCalls[0].args).toEqual(['compose', '-f', composePath, '--env-file', envPath, 'pull']);
    expect(execCalls[0].options).toEqual({ stdio: 'inherit' });
    expect(execCalls[1].args).toEqual(['compose', '-f', composePath, '--env-file', envPath, 'up', '-d']);
    expect(execCalls[1].options).toEqual({ stdio: 'inherit' });

    expect(execCalls[0].args).toContain('pull');
    expect(execCalls[1].args).toContain('up');
    expect(execCalls[1].args).toContain('-d');
    expect(execCalls[0].args).not.toContain('up');
    expect(execCalls[1].args).not.toContain('pull');

    const log = captureLog();
    expect(log).toContain('正在升级 Launchly');
    expect(log).toContain('拉取最新镜像');
    expect(log).toContain('重建服务');
    expect(log).toContain('升级完成。');
  });

  it('stops after a failed pull and does not report upgrade completion', async () => {
    fs.mkdirSync(dataDir, { recursive: true });
    const composePath = path.join(dataDir, 'docker-compose.yml');
    fs.writeFileSync(composePath, 'services: {}\n');
    const failure = new Error('docker compose pull failed');
    queueExec({
      file: 'docker',
      args: ['compose', '-f', composePath, 'pull'],
      throw: failure,
    });

    await expect(runCli(['upgrade'])).rejects.toBe(failure);

    expect(execCalls).toEqual([
      {
        file: 'docker',
        args: ['compose', '-f', composePath, 'pull'],
        options: { stdio: 'inherit' },
      },
    ]);
    expect(captureLog()).not.toContain('重建服务');
    expect(captureLog()).not.toContain('升级完成。');
  });
});

// ─── H. mock strictness (sanity checks) ──────────────────────────────────

describe('CLI execFileSync mock strictness', () => {
  it('unconfigured execFileSync call throws with explicit error naming the command', () => {
    let thrown: Error | null = null;
    try {
      execFileSyncMock('docker', ['ps'], { stdio: 'inherit' });
    } catch (e: any) {
      thrown = e;
    }
    expect(thrown).not.toBeNull();
    expect(thrown!.message).toContain('Unexpected unconfigured execFileSync call: docker');
    unconfiguredCallCount = 0;
  });

  it('process.exit mock throws when invoked (so any unexpected exit fails the test)', () => {
    expect(exitSpy).not.toHaveBeenCalled();
    const impl = exitSpy.getMockImplementation();
    expect(impl).toBeTypeOf('function');
    expect(() => (impl as any)(42)).toThrow('Unexpected process.exit(42)');
    expect(unexpectedExitCalls).toEqual([42]);
    unexpectedExitCalls = [];
  });
});
