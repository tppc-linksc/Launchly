/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ─── child_process.execSync mock (queue + strict default) ─────────────────

interface ExecResult {
  stdout?: string;
  stderr?: string;
  throw?: Error;
}

interface ExecCall {
  command: string;
  options: any;
}

let execCalls: ExecCall[] = [];
let execQueue: ExecResult[] = [];
let unconfiguredCallCount = 0;
let unexpectedExitCalls: Array<number | undefined> = [];

vi.mock('child_process', () => ({
  execSync: vi.fn((command: string, options: any) => {
    execCalls.push({ command, options });
    if (execQueue.length === 0) {
      unconfiguredCallCount++;
      throw new Error(`Unexpected unconfigured execSync call: ${command}`);
    }
    const r = execQueue.shift()!;
    if (r.throw) throw r.throw;
    return r.stdout ?? '';
  }),
}));

function queueExec(r: ExecResult): void {
  execQueue.push(r);
}

const cp = await import('child_process');
const execSyncMock = cp.execSync as unknown as ReturnType<typeof vi.fn>;

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
  execSyncMock.mockClear();
  capturedConsoleOutput = [];

  // Real temp directory; dataDir is a subdir that does not exist yet
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
  // Check strict global effects before restoring mocks, because mockRestore()
  // clears call history in Vitest.
  const strictErrors: string[] = [];
  if (unconfiguredCallCount > 0) {
    strictErrors.push(
      `Test ended with ${unconfiguredCallCount} unconfigured execSync call(s) (mock default impl was triggered; production code called execSync without the test queuing a result)`,
    );
  }
  if (execQueue.length !== 0) {
    strictErrors.push(
      `Test ended with ${execQueue.length} unconsumed execSync result(s); queue must be exactly empty`,
    );
  }
  if (unexpectedExitCalls.length > 0) {
    strictErrors.push(
      `Test ended with ${unexpectedExitCalls.length} unexpected process.exit call(s): ${unexpectedExitCalls.join(', ')}`,
    );
  }

  // Restore argv
  process.argv = originalArgv;
  // Restore env
  if (originalDataDirEnv === undefined) delete process.env.LAUNCHLY_DATA_DIR;
  else process.env.LAUNCHLY_DATA_DIR = originalDataDirEnv;

  consoleSpy.mockRestore();
  stdoutWriteSpy.mockRestore();
  stderrWriteSpy.mockRestore();
  exitSpy.mockRestore();

  vi.resetModules();

  // Clean up only the test-specific temp root; verify it is under os.tmpdir() first
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
  // Dynamic import triggers module evaluation, which runs program.parse() at top level
  await import('../index.js');
}

// ─── A. install --dry-run ─────────────────────────────────────────────────

describe('CLI install --dry-run', () => {
  it('default port: outputs plan, no fs writes, no execSync, includes data dir and URL', async () => {
    await runCli(['install', '--dry-run']);

    // No execSync call (would have been an unconfigured call)
    expect(execCalls).toHaveLength(0);
    // No directory was created
    expect(fs.existsSync(dataDir)).toBe(false);
    expect(fs.existsSync(path.join(dataDir, '.env'))).toBe(false);
    expect(fs.existsSync(path.join(dataDir, 'docker-compose.yml'))).toBe(false);

    const log = captureLog();
    expect(log).toContain('=== Launchly Install (Dry Run) ===');
    expect(log).toContain(`Create data directory: ${dataDir}`);
    expect(log).toContain('http://localhost:8080/setup');
    // No process.exit
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('custom port: --port 9090 is reflected in setup URL and plan', async () => {
    await runCli(['install', '--dry-run', '--port', '9090']);

    expect(execCalls).toHaveLength(0);
    expect(fs.existsSync(dataDir)).toBe(false);

    const log = captureLog();
    expect(log).toContain(`Create data directory: ${dataDir}`);
    expect(log).toContain('http://localhost:9090/setup');
    expect(log).not.toContain('http://localhost:8080/setup');
  });
});

// ─── B. first-time install ────────────────────────────────────────────────

describe('CLI install (first time)', () => {
  it('creates data root + logs/data/config subdirs, .env (mode 0o600) with secrets, compose.yml, single docker command', async () => {
    queueExec({ stdout: '' });
    await runCli(['install']);

    // Directories created
    expect(fs.existsSync(dataDir)).toBe(true);
    expect(fs.statSync(dataDir).isDirectory()).toBe(true);
    expect(fs.existsSync(path.join(dataDir, 'logs'))).toBe(true);
    expect(fs.existsSync(path.join(dataDir, 'data'))).toBe(true);
    expect(fs.existsSync(path.join(dataDir, 'config'))).toBe(true);
    expect(fs.statSync(path.join(dataDir, 'logs')).isDirectory()).toBe(true);
    expect(fs.statSync(path.join(dataDir, 'data')).isDirectory()).toBe(true);
    expect(fs.statSync(path.join(dataDir, 'config')).isDirectory()).toBe(true);

    // .env exists and has 0600 permissions
    const envPath = path.join(dataDir, '.env');
    expect(fs.existsSync(envPath)).toBe(true);
    const envStat = fs.statSync(envPath);
    // mode 0o600 → only owner read/write
    expect(envStat.mode & 0o777).toBe(0o600);

    // .env contents: secrets, image, port, COMPOSE_PROFILES=
    const envContent = fs.readFileSync(envPath, 'utf-8');
    expect(envContent).toMatch(/^LAUNCHLY_DB_PASSWORD=[A-Za-z0-9_-]{24}$/m);
    expect(envContent).toMatch(/^LAUNCHLY_JWT_SECRET=[A-Za-z0-9_-]{32}$/m);
    expect(envContent).toMatch(/^LAUNCHLY_ENCRYPTION_KEY=[A-Za-z0-9_-]{32}$/m);
    expect(envContent).toContain('LAUNCHLY_APP_IMAGE=ghcr.io/tppc-linksc/launchly:latest');
    expect(envContent).toContain('LAUNCHLY_APP_PORT=8080');
    expect(envContent).toContain('COMPOSE_PROFILES=');

    // All three secret values are non-empty
    const dbPwd = envContent.match(/^LAUNCHLY_DB_PASSWORD=(\S+)$/m)![1];
    const jwt = envContent.match(/^LAUNCHLY_JWT_SECRET=(\S+)$/m)![1];
    const encKey = envContent.match(/^LAUNCHLY_ENCRYPTION_KEY=(\S+)$/m)![1];
    expect(dbPwd.length).toBeGreaterThan(0);
    expect(jwt.length).toBeGreaterThan(0);
    expect(encKey.length).toBeGreaterThan(0);

    // compose.yml exists and content matches composeTemplate() byte-for-byte.
    // We import the real composeTemplate to get the canonical value
    const { composeTemplate } = await import('../config.js');
    const composePath = path.join(dataDir, 'docker-compose.yml');
    expect(fs.existsSync(composePath)).toBe(true);
    expect(fs.readFileSync(composePath, 'utf-8')).toBe(composeTemplate());

    // Exactly one execSync call: docker compose -f <compose> --env-file <env> up -d
    expect(execCalls).toHaveLength(1);
    expect(execCalls[0].command).toBe(
      `docker compose -f ${path.join(dataDir, 'docker-compose.yml')} --env-file ${envPath} up -d`,
    );
    expect(execCalls[0].options).toEqual({ stdio: 'inherit' });

    // Success output mentions install completion and the setup URL
    const log = captureLog();
    expect(log).toContain('=== Launchly Install ===');
    expect(log).toContain('Installation complete.');
    expect(log).toContain('http://localhost:8080/setup');
    expect(log).toContain('Create your owner account');
  });

  it('custom port --port 3000 is written into .env and completion output', async () => {
    queueExec({ stdout: '' });
    await runCli(['install', '--port', '3000']);

    const envContent = fs.readFileSync(path.join(dataDir, '.env'), 'utf-8');
    expect(envContent).toContain('LAUNCHLY_APP_PORT=3000');

    const envPath = path.join(dataDir, '.env');
    const composePath = path.join(dataDir, 'docker-compose.yml');
    expect(execCalls).toHaveLength(1);
    expect(execCalls[0]).toEqual({
      command: `docker compose -f ${composePath} --env-file ${envPath} up -d`,
      options: { stdio: 'inherit' },
    });

    const log = captureLog();
    expect(log).toContain('http://localhost:3000/setup');
    expect(log).not.toContain('http://localhost:8080/setup');
  });
});

// ─── C. repeated install ──────────────────────────────────────────────────

describe('CLI install (repeated)', () => {
  it('pre-existing .env bytes are preserved exactly; compose.yml is rewritten; only one docker command; output mentions skipping', async () => {
    // Pre-create data dir and .env with fixed content
    fs.mkdirSync(dataDir, { recursive: true });
    const envPath = path.join(dataDir, '.env');
    const fixedEnv = '# frozen\nLAUNCHLY_DB_PASSWORD=FROZEN_DB\nLAUNCHLY_JWT_SECRET=FROZEN_JWT\nLAUNCHLY_ENCRYPTION_KEY=FROZEN_KEY\nLAUNCHLY_APP_IMAGE=ghcr.io/tppc-linksc/launchly:latest\nLAUNCHLY_APP_PORT=8080\nCOMPOSE_PROFILES=\n';
    fs.writeFileSync(envPath, fixedEnv, { mode: 0o600 });

    queueExec({ stdout: '' });
    await runCli(['install']);

    // .env byte content unchanged
    const envAfter = fs.readFileSync(envPath, 'utf-8');
    expect(envAfter).toBe(fixedEnv);

    // compose.yml is rewritten to current template
    const { composeTemplate } = await import('../config.js');
    expect(fs.readFileSync(path.join(dataDir, 'docker-compose.yml'), 'utf-8')).toBe(composeTemplate());

    // Only one docker command
    expect(execCalls).toHaveLength(1);
    expect(execCalls[0].command).toBe(
      `docker compose -f ${path.join(dataDir, 'docker-compose.yml')} --env-file ${envPath} up -d`,
    );
    expect(execCalls[0].options).toEqual({ stdio: 'inherit' });

    const log = captureLog();
    expect(log).toContain('.env already exists');
    expect(log).toContain('skipping');
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

    queueExec({ stdout: '' });
    await runCli(['up']);

    expect(execCalls).toHaveLength(1);
    expect(execCalls[0].command).toBe(
      `docker compose -f ${composePath} --env-file ${envPath} up -d`,
    );
    expect(execCalls[0].options).toEqual({ stdio: 'inherit' });
    const log = captureLog();
    expect(log).toContain('Starting Launchly services');
    expect(log).toContain('Services started.');
  });

  it('without .env: docker compose ... up -d (no --env-file flag)', async () => {
    fs.mkdirSync(dataDir, { recursive: true });
    const composePath = path.join(dataDir, 'docker-compose.yml');
    fs.writeFileSync(composePath, 'services: {}\n');

    queueExec({ stdout: '' });
    await runCli(['up']);

    expect(execCalls).toHaveLength(1);
    expect(execCalls[0].command).toBe(`docker compose -f ${composePath} up -d`);
    expect(execCalls[0].command).not.toContain('--env-file');
    expect(execCalls[0].options).toEqual({ stdio: 'inherit' });
  });

  it('propagates an execSync failure and does not print a false success', async () => {
    fs.mkdirSync(dataDir, { recursive: true });
    const composePath = path.join(dataDir, 'docker-compose.yml');
    fs.writeFileSync(composePath, 'services: {}\n');
    const failure = new Error('docker compose up failed');
    queueExec({ throw: failure });

    await expect(runCli(['up'])).rejects.toBe(failure);

    expect(execCalls).toEqual([{
      command: `docker compose -f ${composePath} up -d`,
      options: { stdio: 'inherit' },
    }]);
    expect(captureLog()).not.toContain('Services started.');
  });
});

describe('CLI down', () => {
  it('with .env: docker compose ... --env-file ... down', async () => {
    fs.mkdirSync(dataDir, { recursive: true });
    const envPath = path.join(dataDir, '.env');
    fs.writeFileSync(envPath, 'LAUNCHLY_DB_PASSWORD=x\n', { mode: 0o600 });
    const composePath = path.join(dataDir, 'docker-compose.yml');
    fs.writeFileSync(composePath, 'services: {}\n');

    queueExec({ stdout: '' });
    await runCli(['down']);

    expect(execCalls).toHaveLength(1);
    expect(execCalls[0].command).toBe(
      `docker compose -f ${composePath} --env-file ${envPath} down`,
    );
    expect(execCalls[0].options).toEqual({ stdio: 'inherit' });
    const log = captureLog();
    expect(log).toContain('Stopping Launchly services');
    expect(log).toContain('Services stopped.');
  });
});

describe('CLI restart', () => {
  it('with .env: docker compose ... --env-file ... restart', async () => {
    fs.mkdirSync(dataDir, { recursive: true });
    const envPath = path.join(dataDir, '.env');
    fs.writeFileSync(envPath, 'LAUNCHLY_DB_PASSWORD=x\n', { mode: 0o600 });
    const composePath = path.join(dataDir, 'docker-compose.yml');
    fs.writeFileSync(composePath, 'services: {}\n');

    queueExec({ stdout: '' });
    await runCli(['restart']);

    expect(execCalls).toHaveLength(1);
    expect(execCalls[0].command).toBe(
      `docker compose -f ${composePath} --env-file ${envPath} restart`,
    );
    expect(execCalls[0].options).toEqual({ stdio: 'inherit' });
  });
});

// ─── E. status ───────────────────────────────────────────────────────────

describe('CLI status', () => {
  it('success path: docker compose -f <compose> ps, { stdio: inherit }', async () => {
    fs.mkdirSync(dataDir, { recursive: true });
    const composePath = path.join(dataDir, 'docker-compose.yml');
    fs.writeFileSync(composePath, 'services: {}\n');

    queueExec({ stdout: '' });
    await runCli(['status']);

    expect(execCalls).toHaveLength(1);
    expect(execCalls[0].command).toBe(`docker compose -f ${composePath} ps`);
    expect(execCalls[0].options).toEqual({ stdio: 'inherit' });
  });

  it('execSync failure: catch handles, output install prompt; no process.exit', async () => {
    fs.mkdirSync(dataDir, { recursive: true });
    const composePath = path.join(dataDir, 'docker-compose.yml');
    fs.writeFileSync(composePath, 'services: {}\n');

    queueExec({ throw: new Error('docker not available') });

    await runCli(['status']);

    expect(execCalls).toHaveLength(1);
    expect(execCalls[0].command).toBe(`docker compose -f ${composePath} ps`);
    const log = captureLog();
    expect(log).toContain('Launchly services not found');
    expect(log).toContain('launchly install');
    // No process.exit even though execSync threw
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

    queueExec({ stdout: '' });
    await runCli(['logs']);

    expect(execCalls).toHaveLength(1);
    expect(execCalls[0].command).toBe(
      `docker compose -f ${composePath} --env-file ${envPath} logs`,
    );
    expect(execCalls[0].options).toEqual({ stdio: 'inherit' });
  });

  it('--follow: docker compose ... logs -f', async () => {
    fs.mkdirSync(dataDir, { recursive: true });
    const envPath = path.join(dataDir, '.env');
    fs.writeFileSync(envPath, 'LAUNCHLY_DB_PASSWORD=x\n', { mode: 0o600 });
    const composePath = path.join(dataDir, 'docker-compose.yml');
    fs.writeFileSync(composePath, 'services: {}\n');

    queueExec({ stdout: '' });
    await runCli(['logs', '--follow']);

    expect(execCalls).toHaveLength(1);
    expect(execCalls[0].command).toBe(
      `docker compose -f ${composePath} --env-file ${envPath} logs -f`,
    );
    expect(execCalls[0].options).toEqual({ stdio: 'inherit' });
  });

  it('--service launchly-api: docker compose ... logs launchly-api', async () => {
    fs.mkdirSync(dataDir, { recursive: true });
    const envPath = path.join(dataDir, '.env');
    fs.writeFileSync(envPath, 'LAUNCHLY_DB_PASSWORD=x\n', { mode: 0o600 });
    const composePath = path.join(dataDir, 'docker-compose.yml');
    fs.writeFileSync(composePath, 'services: {}\n');

    queueExec({ stdout: '' });
    await runCli(['logs', '--service', 'launchly-api']);

    expect(execCalls).toHaveLength(1);
    expect(execCalls[0].command).toBe(
      `docker compose -f ${composePath} --env-file ${envPath} logs launchly-api`,
    );
    expect(execCalls[0].options).toEqual({ stdio: 'inherit' });
  });

  it('--follow + --service: docker compose ... logs -f launchly-worker (order: -f before service)', async () => {
    fs.mkdirSync(dataDir, { recursive: true });
    const envPath = path.join(dataDir, '.env');
    fs.writeFileSync(envPath, 'LAUNCHLY_DB_PASSWORD=x\n', { mode: 0o600 });
    const composePath = path.join(dataDir, 'docker-compose.yml');
    fs.writeFileSync(composePath, 'services: {}\n');

    queueExec({ stdout: '' });
    await runCli(['logs', '--follow', '--service', 'launchly-worker']);

    expect(execCalls).toHaveLength(1);
    expect(execCalls[0].command).toBe(
      `docker compose -f ${composePath} --env-file ${envPath} logs -f launchly-worker`,
    );
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

    queueExec({ stdout: '' }); // pull
    queueExec({ stdout: '' }); // up -d
    await runCli(['upgrade']);

    expect(execCalls).toHaveLength(2);
    // 1st: pull
    expect(execCalls[0].command).toBe(
      `docker compose -f ${composePath} --env-file ${envPath} pull`,
    );
    expect(execCalls[0].options).toEqual({ stdio: 'inherit' });
    // 2nd: up -d
    expect(execCalls[1].command).toBe(
      `docker compose -f ${composePath} --env-file ${envPath} up -d`,
    );
    expect(execCalls[1].options).toEqual({ stdio: 'inherit' });
    // Order is exactly pull → up -d
    expect(execCalls[0].command).toContain(' pull');
    expect(execCalls[1].command).toContain(' up -d');
    expect(execCalls[0].command).not.toContain(' up -d');
    expect(execCalls[1].command).not.toContain(' pull');

    const log = captureLog();
    expect(log).toContain('Upgrading Launchly');
    expect(log).toContain('Pulling latest images');
    expect(log).toContain('Recreating services');
    expect(log).toContain('Upgrade complete.');
  });

  it('stops after a failed pull and does not report upgrade completion', async () => {
    fs.mkdirSync(dataDir, { recursive: true });
    const composePath = path.join(dataDir, 'docker-compose.yml');
    fs.writeFileSync(composePath, 'services: {}\n');
    const failure = new Error('docker compose pull failed');
    queueExec({ throw: failure });

    await expect(runCli(['upgrade'])).rejects.toBe(failure);

    expect(execCalls).toEqual([{
      command: `docker compose -f ${composePath} pull`,
      options: { stdio: 'inherit' },
    }]);
    expect(captureLog()).not.toContain('Recreating services');
    expect(captureLog()).not.toContain('Upgrade complete.');
  });
});

// ─── H. mock strictness (sanity checks) ──────────────────────────────────

describe('CLI execSync mock strictness', () => {
  it('unconfigured execSync call throws with explicit error naming the command', () => {
    // This test deliberately triggers the default-impl throw to verify the
    // mock's strict behavior. We then reset the counter so the afterEach
    // strict-consumption check does not also fire.
    let thrown: Error | null = null;
    try {
      execSyncMock('docker ps', { stdio: 'inherit' });
    } catch (e: any) {
      thrown = e;
    }
    expect(thrown).not.toBeNull();
    expect(thrown!.message).toContain('Unexpected unconfigured execSync call: docker ps');
    unconfiguredCallCount = 0;
  });

  it('process.exit mock throws when invoked (so any unexpected exit fails the test)', () => {
    // exitSpy.mock.calls is [] at this point (no command under test has triggered exit)
    expect(exitSpy).not.toHaveBeenCalled();
    // Invoking the mocked implementation should throw
    const impl = exitSpy.getMockImplementation();
    expect(impl).toBeTypeOf('function');
    expect(() => (impl as any)(42)).toThrow('Unexpected process.exit(42)');
    expect(unexpectedExitCalls).toEqual([42]);
    unexpectedExitCalls = [];
  });
});
