/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ─── child_process.execSync mock (command+options match at call time) ────

interface ExecPlan {
  command: string;
  options: any;
  stdout?: string;
  throw?: Error;
}

interface ExecCall {
  command: string;
  options: any;
}

let execPlans: ExecPlan[] = [];
let execCalls: ExecCall[] = [];
let unexpectedCalls: ExecCall[] = [];
let execContractFailures: string[] = [];

vi.mock('child_process', () => ({
  execSync: vi.fn((command: string, options: any) => {
    execCalls.push({ command, options });
    const plan = execPlans.shift();
    if (!plan) {
      unexpectedCalls.push({ command, options });
      throw new Error(`Unexpected execSync call (no plan matched): ${command}`);
    }
    if (plan.command !== command) {
      const failure =
        `execSync command mismatch: expected ${JSON.stringify(plan.command)}, ` +
        `got ${JSON.stringify(command)}`;
      execContractFailures.push(failure);
      throw new Error(failure);
    }
    if (JSON.stringify(plan.options) !== JSON.stringify(options)) {
      const failure =
        `execSync options mismatch for command ${JSON.stringify(command)}: ` +
        `expected ${JSON.stringify(plan.options)}, got ${JSON.stringify(options)}`;
      execContractFailures.push(failure);
      throw new Error(failure);
    }
    if (plan.throw) throw plan.throw;
    return plan.stdout ?? '';
  }),
}));

function queueExec(p: ExecPlan): void {
  execPlans.push(p);
}

const cp = await import('child_process');
const execSyncMock = cp.execSync as unknown as ReturnType<typeof vi.fn>;

// ─── fs mock (statfsSync only; everything else is real) ──────────────────

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    statfsSync: vi.fn(),
  };
});

const fsModule = await import('fs');
const statfsSyncMock = fsModule.statfsSync as unknown as ReturnType<typeof vi.fn>;

// ─── os mock (homedir only; tmpdir() stays real) ──────────────────────────

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    homedir: vi.fn(),
  };
});

const osModule = await import('os');
const homedirMock = osModule.homedir as unknown as ReturnType<typeof vi.fn>;

// ─── Test fixture setup / teardown ────────────────────────────────────────

let tmpRoot: string;
let dataDir: string;
let originalArgv: string[];
let originalDataDirEnv: string | undefined;
let consoleSpy: ReturnType<typeof vi.spyOn>;
let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;
let stderrWriteSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;
let capturedOutput: string[] = [];
let capturedExitCodes: number[] = [];

function getOutput(): string {
  return capturedOutput.join('');
}

function fakeStatfs(availGB: number) {
  const bsize = 4096;
  const bavail = Math.floor((availGB * 1_073_741_824) / bsize);
  return { type: 0, bsize, blocks: 0, bfree: 0, bavail, files: 0, ffree: 0 } as any;
}

beforeEach(() => {
  execPlans = [];
  execCalls = [];
  unexpectedCalls = [];
  execContractFailures = [];
  execSyncMock.mockClear();
  statfsSyncMock.mockReset();
  homedirMock.mockReset();

  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'launchly-doctor-test-'));
  dataDir = path.join(tmpRoot, 'data');
  // Point os.homedir() inside the test tmp root
  homedirMock.mockImplementation(() => tmpRoot);

  originalArgv = process.argv;
  originalDataDirEnv = process.env.LAUNCHLY_DATA_DIR;
  process.env.LAUNCHLY_DATA_DIR = dataDir;

  capturedOutput = [];
  capturedExitCodes = [];

  consoleSpy = vi.spyOn(console, 'log').mockImplementation((...args: any[]) => {
    capturedOutput.push(
      args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ') + '\n',
    );
    return undefined;
  });
  stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
    capturedOutput.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  });
  stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as any);
  exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    capturedExitCodes.push(code ?? -1);
    throw new Error(`Unexpected process.exit(${code})`);
  }) as any);
});

afterEach(() => {
  // Snapshot before mockRestore
  const exitCodesSnapshot = [...capturedExitCodes];
  const unexpectedSnapshot = [...unexpectedCalls];
  const contractFailuresSnapshot = [...execContractFailures];
  const plansSnapshot = [...execPlans];

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

  // Strict checks
  if (plansSnapshot.length !== 0) {
    throw new Error(
      `Test ended with ${plansSnapshot.length} unconsumed execSync plan(s); expected all plans to be exactly consumed`,
    );
  }
  if (unexpectedSnapshot.length !== 0) {
    throw new Error(
      `Test ended with ${unexpectedSnapshot.length} unexpected execSync call(s): ` +
        unexpectedSnapshot.map((u) => JSON.stringify(u.command)).join('; '),
    );
  }
  if (contractFailuresSnapshot.length !== 0) {
    throw new Error(
      `Test ended with ${contractFailuresSnapshot.length} execSync contract failure(s): ` +
        contractFailuresSnapshot.join('; '),
    );
  }
  if (exitCodesSnapshot.length !== 0) {
    throw new Error(
      `Test ended with ${exitCodesSnapshot.length} unexpected process.exit call(s): ` +
        exitCodesSnapshot.join(', '),
    );
  }
});

async function runDoctor(): Promise<void> {
  process.argv = ['node', 'launchly', 'doctor'];
  vi.resetModules();
  await import('../index.js');
}

// ─── Scenario 1: 主要组件正常 ────────────────────────────────────────────

describe('CLI doctor - scenario 1: all components OK', () => {
  it('docker OK v27.3.1, compose OK v2.29.2, no legacy fallback, ports 8080 IN USE / 5173 FREE / 5432 FREE, 2.0 GB OK, data dir EXISTS, final Doctor complete', async () => {
    queueExec({ command: 'docker version --format "{{.Server.Version}}"', options: { encoding: 'utf-8' }, stdout: '27.3.1\n' });
    queueExec({ command: 'docker compose version --short', options: { encoding: 'utf-8' }, stdout: '2.29.2\n' });
    queueExec({ command: 'lsof -i :8080 -sTCP:LISTEN', options: { encoding: 'utf-8' }, stdout: '...\n' });
    queueExec({ command: 'lsof -i :5173 -sTCP:LISTEN', options: { encoding: 'utf-8' }, throw: new Error('not in use') });
    queueExec({ command: 'lsof -i :5432 -sTCP:LISTEN', options: { encoding: 'utf-8' }, throw: new Error('not in use') });

    statfsSyncMock.mockImplementation(() => fakeStatfs(2.0));
    fs.mkdirSync(dataDir, { recursive: true });

    await runDoctor();

    // Exactly 5 execSync calls in exact order
    expect(execCalls).toHaveLength(5);
    expect(execCalls.map((c) => c.command)).toEqual([
      'docker version --format "{{.Server.Version}}"',
      'docker compose version --short',
      'lsof -i :8080 -sTCP:LISTEN',
      'lsof -i :5173 -sTCP:LISTEN',
      'lsof -i :5432 -sTCP:LISTEN',
    ]);
    // Every call used { encoding: 'utf-8' }
    for (let i = 0; i < 5; i++) {
      expect(execCalls[i].options).toEqual({ encoding: 'utf-8' });
    }

    // No legacy docker-compose fallback
    expect(execCalls.find((c) => c.command === 'docker-compose version --short')).toBeUndefined();

    expect(statfsSyncMock).toHaveBeenCalledTimes(1);
    expect(statfsSyncMock).toHaveBeenCalledWith(tmpRoot);

    expect(exitSpy).not.toHaveBeenCalled();

    const out = getOutput();
    expect(out).toBe(
      '=== Launchly Doctor ===\n\n' +
        'Docker ....................... OK (v27.3.1)\n' +
        'Docker Compose .............. OK (v2.29.2)\n' +
        'Ports ........................\n' +
        '  8080 (launchly-app) ............... IN USE\n' +
        '  5173 (launchly-web (dev)) ............... FREE\n' +
        '  5432 (launchly-postgres) ............... FREE\n' +
        'Disk space ................... OK (2.0 GB available)\n' +
        `Data directory (${dataDir}) ... EXISTS\n` +
        '\nDoctor check complete.\n',
    );
  });
});

// ─── Scenario 2: fallback + warning ───────────────────────────────────────

describe('CLI doctor - scenario 2: fallback to legacy compose + low disk + data dir is a file', () => {
  it('docker NOT FOUND, plugin fails → legacy compose OK v1.29.2, all ports FREE, 0.5 GB WARNING + fix, data dir EXISTS BUT NOT A DIRECTORY, Doctor complete', async () => {
    queueExec({ command: 'docker version --format "{{.Server.Version}}"', options: { encoding: 'utf-8' }, throw: new Error('docker not installed') });
    queueExec({ command: 'docker compose version --short', options: { encoding: 'utf-8' }, throw: new Error('plugin missing') });
    queueExec({ command: 'docker-compose version --short', options: { encoding: 'utf-8' }, stdout: '1.29.2\n' });
    queueExec({ command: 'lsof -i :8080 -sTCP:LISTEN', options: { encoding: 'utf-8' }, throw: new Error('not in use') });
    queueExec({ command: 'lsof -i :5173 -sTCP:LISTEN', options: { encoding: 'utf-8' }, throw: new Error('not in use') });
    queueExec({ command: 'lsof -i :5432 -sTCP:LISTEN', options: { encoding: 'utf-8' }, throw: new Error('not in use') });

    statfsSyncMock.mockImplementation(() => fakeStatfs(0.5));

    fs.mkdirSync(tmpRoot, { recursive: true });
    fs.writeFileSync(dataDir, 'this is a file, not a directory\n');

    await runDoctor();

    expect(execCalls).toHaveLength(6);
    expect(execCalls.map((c) => c.command)).toEqual([
      'docker version --format "{{.Server.Version}}"',
      'docker compose version --short',
      'docker-compose version --short',
      'lsof -i :8080 -sTCP:LISTEN',
      'lsof -i :5173 -sTCP:LISTEN',
      'lsof -i :5432 -sTCP:LISTEN',
    ]);
    expect(execCalls.every((call) => call.options.encoding === 'utf-8')).toBe(true);

    expect(statfsSyncMock).toHaveBeenCalledTimes(1);
    expect(statfsSyncMock).toHaveBeenCalledWith(tmpRoot);
    expect(exitSpy).not.toHaveBeenCalled();

    const out = getOutput();
    expect(out).toBe(
      '=== Launchly Doctor ===\n\n' +
        'Docker ....................... NOT FOUND\n' +
        '  Fix: Install Docker from https://docs.docker.com/get-docker/\n' +
        'Docker Compose .............. OK (v1.29.2)\n' +
        'Ports ........................\n' +
        '  8080 (launchly-app) ............... FREE\n' +
        '  5173 (launchly-web (dev)) ............... FREE\n' +
        '  5432 (launchly-postgres) ............... FREE\n' +
        'Disk space ................... WARNING (0.5 GB available)\n' +
        '  Launchly needs at least 1 GB free space.\n' +
        `Data directory (${dataDir}) ... EXISTS BUT NOT A DIRECTORY\n` +
        '\nDoctor check complete.\n',
    );
  });
});

// ─── Scenario 3: 诊断能力不可用 ───────────────────────────────────────────

describe('CLI doctor - scenario 3: diagnostics unavailable', () => {
  it('docker OK, plugin + legacy compose fail → Compose NOT FOUND, port 8080 IN USE, statfsSync throws → UNABLE TO CHECK, data dir missing → NOT YET CREATED, Doctor complete', async () => {
    queueExec({ command: 'docker version --format "{{.Server.Version}}"', options: { encoding: 'utf-8' }, stdout: '24.0.7\n' });
    queueExec({ command: 'docker compose version --short', options: { encoding: 'utf-8' }, throw: new Error('plugin missing') });
    queueExec({ command: 'docker-compose version --short', options: { encoding: 'utf-8' }, throw: new Error('legacy missing') });
    queueExec({ command: 'lsof -i :8080 -sTCP:LISTEN', options: { encoding: 'utf-8' }, stdout: '...\n' });
    queueExec({ command: 'lsof -i :5173 -sTCP:LISTEN', options: { encoding: 'utf-8' }, throw: new Error('not in use') });
    queueExec({ command: 'lsof -i :5432 -sTCP:LISTEN', options: { encoding: 'utf-8' }, throw: new Error('not in use') });

    statfsSyncMock.mockImplementation(() => { throw new Error('statfs unavailable'); });

    // data dir does NOT exist

    await runDoctor();

    expect(execCalls).toHaveLength(6);
    expect(execCalls.map((c) => c.command)).toEqual([
      'docker version --format "{{.Server.Version}}"',
      'docker compose version --short',
      'docker-compose version --short',
      'lsof -i :8080 -sTCP:LISTEN',
      'lsof -i :5173 -sTCP:LISTEN',
      'lsof -i :5432 -sTCP:LISTEN',
    ]);

    expect(statfsSyncMock).toHaveBeenCalledTimes(1);
    expect(statfsSyncMock).toHaveBeenCalledWith(tmpRoot);

    expect(exitSpy).not.toHaveBeenCalled();

    const out = getOutput();
    expect(out).toBe(
      '=== Launchly Doctor ===\n\n' +
        'Docker ....................... OK (v24.0.7)\n' +
        'Docker Compose .............. NOT FOUND\n' +
        '  Fix: Install Docker Compose plugin or Docker Desktop.\n' +
        'Ports ........................\n' +
        '  8080 (launchly-app) ............... IN USE\n' +
        '  5173 (launchly-web (dev)) ............... FREE\n' +
        '  5432 (launchly-postgres) ............... FREE\n' +
        'Disk space ................... UNABLE TO CHECK\n' +
        `Data directory (${dataDir}) ... NOT YET CREATED (will be created on install)\n` +
        '\nDoctor check complete.\n',
    );
  });
});
