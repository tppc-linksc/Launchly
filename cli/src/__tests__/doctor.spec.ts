/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// KI-041 修复后：doctor 也改用 execFileSync(file, args, options)。
// mock 严格按 file/args/options 匹配。

interface ExecPlan {
  file?: string;
  args?: string[];
  options?: any;
  stdout?: string;
  throw?: Error;
}

interface ExecCall {
  file: string;
  args: string[];
  options: any;
}

let execPlans: ExecPlan[] = [];
let execCalls: ExecCall[] = [];
let unexpectedCalls: ExecCall[] = [];
let execContractFailures: string[] = [];

function argsEqual(a: string[], b: string[] | undefined): boolean {
  if (!b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

vi.mock('child_process', () => ({
  execFileSync: vi.fn((file: string, args: string[], options: any) => {
    execCalls.push({ file, args, options });
    const plan = execPlans.shift();
    if (!plan) {
      unexpectedCalls.push({ file, args, options });
      throw new Error(`Unexpected execFileSync call (no plan matched): ${file} ${JSON.stringify(args)}`);
    }
    if (plan.file !== undefined && plan.file !== file) {
      const failure = `execFileSync file mismatch: expected ${JSON.stringify(plan.file)}, got ${JSON.stringify(file)}`;
      execContractFailures.push(failure);
      throw new Error(failure);
    }
    if (plan.args !== undefined && !argsEqual(args, plan.args)) {
      const failure = `execFileSync args mismatch: expected ${JSON.stringify(plan.args)}, got ${JSON.stringify(args)}`;
      execContractFailures.push(failure);
      throw new Error(failure);
    }
    if (plan.options !== undefined && JSON.stringify(plan.options) !== JSON.stringify(options)) {
      const failure = `execFileSync options mismatch: expected ${JSON.stringify(plan.options)}, got ${JSON.stringify(options)}`;
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
const execFileSyncMock = cp.execFileSync as unknown as ReturnType<typeof vi.fn>;

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    statfsSync: vi.fn(),
  };
});

const fsModule = await import('fs');
const statfsSyncMock = fsModule.statfsSync as unknown as ReturnType<typeof vi.fn>;

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    homedir: vi.fn(),
  };
});

const osModule = await import('os');
const homedirMock = osModule.homedir as unknown as ReturnType<typeof vi.fn>;

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
  execFileSyncMock.mockClear();
  statfsSyncMock.mockReset();
  homedirMock.mockReset();

  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'launchly-doctor-test-'));
  dataDir = path.join(tmpRoot, 'data');
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

  if (plansSnapshot.length !== 0) {
    throw new Error(
      `Test ended with ${plansSnapshot.length} unconsumed execFileSync plan(s); expected all plans to be exactly consumed`,
    );
  }
  if (unexpectedSnapshot.length !== 0) {
    throw new Error(
      `Test ended with ${unexpectedSnapshot.length} unexpected execFileSync call(s): ` +
        unexpectedSnapshot.map((u) => `${u.file} ${JSON.stringify(u.args)}`).join('; '),
    );
  }
  if (contractFailuresSnapshot.length !== 0) {
    throw new Error(
      `Test ended with ${contractFailuresSnapshot.length} execFileSync contract failure(s): ` +
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

describe('CLI doctor - scenario 1: all components OK', () => {
  it('docker OK v27.3.1, compose OK v2.29.2, no legacy fallback, ports 8080 IN USE / 5173 FREE / 5432 FREE, 2.0 GB OK, data dir EXISTS, final Doctor complete', async () => {
    queueExec({
      file: 'docker',
      args: ['version', '--format', '{{.Server.Version}}'],
      options: { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      stdout: '27.3.1\n',
    });
    queueExec({
      file: 'docker',
      args: ['compose', 'version', '--short'],
      options: { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      stdout: '2.29.2\n',
    });
    queueExec({
      file: 'lsof',
      args: ['-i', ':8080', '-sTCP:LISTEN'],
      options: { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      stdout: '...\n',
    });
    queueExec({
      file: 'lsof',
      args: ['-i', ':5173', '-sTCP:LISTEN'],
      options: { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      throw: new Error('not in use'),
    });
    queueExec({
      file: 'lsof',
      args: ['-i', ':5432', '-sTCP:LISTEN'],
      options: { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      throw: new Error('not in use'),
    });

    statfsSyncMock.mockImplementation(() => fakeStatfs(2.0));
    fs.mkdirSync(dataDir, { recursive: true });

    await runDoctor();

    expect(execCalls).toHaveLength(5);
    expect(execCalls.map((c) => `${c.file} ${JSON.stringify(c.args)}`)).toEqual([
      'docker ["version","--format","{{.Server.Version}}"]',
      'docker ["compose","version","--short"]',
      'lsof ["-i",":8080","-sTCP:LISTEN"]',
      'lsof ["-i",":5173","-sTCP:LISTEN"]',
      'lsof ["-i",":5432","-sTCP:LISTEN"]',
    ]);

    expect(execCalls.find((c) => c.file === 'docker-compose')).toBeUndefined();

    expect(statfsSyncMock).toHaveBeenCalledTimes(1);
    expect(statfsSyncMock).toHaveBeenCalledWith(tmpRoot);

    expect(exitSpy).not.toHaveBeenCalled();

    const out = getOutput();
    expect(out).toBe(
      '=== Launchly Doctor ===\n\n' +
        'Docker ....................... OK (v27.3.1)\n' +
        'Docker Compose .............. OK (v2.29.2)\n' +
        '端口 ........................\n' +
        '  8080 (launchly-app) ............... 占用\n' +
        '  5173 (launchly-web (dev)) ............... 空闲\n' +
        '  5432 (launchly-postgres) ............... 空闲\n' +
        '磁盘空间 ................... OK（剩余 2.0 GB）\n' +
        `数据目录 (${dataDir}) ... 已存在\n` +
        '\nDoctor 检查完成。\n',
    );
  });
});

describe('CLI doctor - scenario 2: fallback to legacy compose + low disk + data dir is a file', () => {
  it('docker NOT FOUND, plugin fails → legacy compose OK v1.29.2, all ports FREE, 0.5 GB WARNING + fix, data dir EXISTS BUT NOT A DIRECTORY, Doctor complete', async () => {
    queueExec({
      file: 'docker',
      args: ['version', '--format', '{{.Server.Version}}'],
      options: { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      throw: new Error('docker not installed'),
    });
    queueExec({
      file: 'docker',
      args: ['compose', 'version', '--short'],
      options: { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      throw: new Error('plugin missing'),
    });
    queueExec({
      file: 'docker-compose',
      args: ['version', '--short'],
      options: { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      stdout: '1.29.2\n',
    });
    queueExec({
      file: 'lsof',
      args: ['-i', ':8080', '-sTCP:LISTEN'],
      options: { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      throw: new Error('not in use'),
    });
    queueExec({
      file: 'lsof',
      args: ['-i', ':5173', '-sTCP:LISTEN'],
      options: { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      throw: new Error('not in use'),
    });
    queueExec({
      file: 'lsof',
      args: ['-i', ':5432', '-sTCP:LISTEN'],
      options: { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      throw: new Error('not in use'),
    });

    statfsSyncMock.mockImplementation(() => fakeStatfs(0.5));

    fs.mkdirSync(tmpRoot, { recursive: true });
    fs.writeFileSync(dataDir, 'this is a file, not a directory\n');

    await runDoctor();

    expect(execCalls).toHaveLength(6);
    expect(execCalls.map((c) => `${c.file} ${JSON.stringify(c.args)}`)).toEqual([
      'docker ["version","--format","{{.Server.Version}}"]',
      'docker ["compose","version","--short"]',
      'docker-compose ["version","--short"]',
      'lsof ["-i",":8080","-sTCP:LISTEN"]',
      'lsof ["-i",":5173","-sTCP:LISTEN"]',
      'lsof ["-i",":5432","-sTCP:LISTEN"]',
    ]);

    expect(statfsSyncMock).toHaveBeenCalledTimes(1);
    expect(statfsSyncMock).toHaveBeenCalledWith(tmpRoot);
    expect(exitSpy).not.toHaveBeenCalled();

    const out = getOutput();
    expect(out).toBe(
      '=== Launchly Doctor ===\n\n' +
        'Docker ....................... 未找到\n' +
        '  修复方法：从 https://docs.docker.com/get-docker/ 安装 Docker\n' +
        'Docker Compose .............. OK (v1.29.2)\n' +
        '端口 ........................\n' +
        '  8080 (launchly-app) ............... 空闲\n' +
        '  5173 (launchly-web (dev)) ............... 空闲\n' +
        '  5432 (launchly-postgres) ............... 空闲\n' +
        '磁盘空间 ................... 警告（剩余 0.5 GB）\n' +
        '  Launchly 至少需要 1 GB 可用空间。\n' +
        `数据目录 (${dataDir}) ... 已存在但不是目录\n` +
        '\nDoctor 检查完成。\n',
    );
  });
});

describe('CLI doctor - scenario 3: diagnostics unavailable', () => {
  it('docker OK, plugin + legacy compose fail → Compose NOT FOUND, port 8080 IN USE, statfsSync throws → UNABLE TO CHECK, data dir missing → NOT YET CREATED, Doctor complete', async () => {
    queueExec({
      file: 'docker',
      args: ['version', '--format', '{{.Server.Version}}'],
      options: { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      stdout: '24.0.7\n',
    });
    queueExec({
      file: 'docker',
      args: ['compose', 'version', '--short'],
      options: { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      throw: new Error('plugin missing'),
    });
    queueExec({
      file: 'docker-compose',
      args: ['version', '--short'],
      options: { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      throw: new Error('legacy missing'),
    });
    queueExec({
      file: 'lsof',
      args: ['-i', ':8080', '-sTCP:LISTEN'],
      options: { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      stdout: '...\n',
    });
    queueExec({
      file: 'lsof',
      args: ['-i', ':5173', '-sTCP:LISTEN'],
      options: { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      throw: new Error('not in use'),
    });
    queueExec({
      file: 'lsof',
      args: ['-i', ':5432', '-sTCP:LISTEN'],
      options: { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      throw: new Error('not in use'),
    });

    statfsSyncMock.mockImplementation(() => { throw new Error('statfs unavailable'); });

    await runDoctor();

    expect(execCalls).toHaveLength(6);
    expect(execCalls.map((c) => `${c.file} ${JSON.stringify(c.args)}`)).toEqual([
      'docker ["version","--format","{{.Server.Version}}"]',
      'docker ["compose","version","--short"]',
      'docker-compose ["version","--short"]',
      'lsof ["-i",":8080","-sTCP:LISTEN"]',
      'lsof ["-i",":5173","-sTCP:LISTEN"]',
      'lsof ["-i",":5432","-sTCP:LISTEN"]',
    ]);

    expect(statfsSyncMock).toHaveBeenCalledTimes(1);
    expect(statfsSyncMock).toHaveBeenCalledWith(tmpRoot);

    expect(exitSpy).not.toHaveBeenCalled();

    const out = getOutput();
    expect(out).toBe(
      '=== Launchly Doctor ===\n\n' +
        'Docker ....................... OK (v24.0.7)\n' +
        'Docker Compose .............. 未找到\n' +
        '  修复方法：安装 Docker Compose 插件或 Docker Desktop。\n' +
        '端口 ........................\n' +
        '  8080 (launchly-app) ............... 占用\n' +
        '  5173 (launchly-web (dev)) ............... 空闲\n' +
        '  5432 (launchly-postgres) ............... 空闲\n' +
        '磁盘空间 ................... 无法检查\n' +
        `数据目录 (${dataDir}) ... 尚未创建（安装时将自动创建）\n` +
        '\nDoctor 检查完成。\n',
    );
  });
});
