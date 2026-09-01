/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// KI-041 修复后：所有外部命令使用 execFileSync(file, args, options)。
// 测试 mock 改为按 args 数组内容匹配，并校验 file 与 options。

type ExecOptions = any;
type ExecResult = {
  file?: string;
  args?: string[];
  options?: ExecOptions;
  stdout?: string;
  throw?: Error;
  sideEffect?: (file: string, args: string[]) => void;
};
type ExecCall = { file: string; args: string[]; options: ExecOptions };

let execQueue: ExecResult[] = [];
let execCalls: ExecCall[] = [];
let unexpectedCalls: ExecCall[] = [];
let contractFailures: string[] = [];

function argsEqual(a: string[], b: string[] | undefined): boolean {
  if (!b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

vi.mock('child_process', () => ({
  execFileSync: vi.fn((file: string, args: string[], options: ExecOptions) => {
    execCalls.push({ file, args, options });
    const plan = execQueue.shift();
    if (!plan) {
      unexpectedCalls.push({ file, args, options });
      throw new Error(`Unexpected execFileSync call (no plan matched): ${file} ${JSON.stringify(args)}`);
    }
    if (plan.file !== undefined && plan.file !== file) {
      const failure = `execFileSync file mismatch: expected ${JSON.stringify(plan.file)}, got ${JSON.stringify(file)}`;
      contractFailures.push(failure);
      throw new Error(failure);
    }
    if (plan.args !== undefined && !argsEqual(args, plan.args)) {
      const failure = `execFileSync args mismatch: expected ${JSON.stringify(plan.args)}, got ${JSON.stringify(args)}`;
      contractFailures.push(failure);
      throw new Error(failure);
    }
    if (plan.options !== undefined && JSON.stringify(plan.options) !== JSON.stringify(options)) {
      const failure = `execFileSync options mismatch for ${JSON.stringify(args)}: expected ${JSON.stringify(plan.options)}, got ${JSON.stringify(options)}`;
      contractFailures.push(failure);
      throw new Error(failure);
    }
    if (plan.sideEffect) plan.sideEffect(file, args);
    if (plan.throw) throw plan.throw;
    return plan.stdout ?? '';
  }),
}));

const cp = await import('child_process');
const execFileSyncMock = cp.execFileSync as unknown as ReturnType<typeof vi.fn>;

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    openSync: vi.fn(),
    readSync: vi.fn(),
    closeSync: vi.fn(),
  };
});

let tmpRoot: string;
let dataDir: string;
let originalArgv: string[];
let originalDataDirEnv: string | undefined;

let consoleSpy: ReturnType<typeof vi.spyOn>;
let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;
let copyFileSyncSpy: ReturnType<typeof vi.spyOn>;
let cpSyncSpy: ReturnType<typeof vi.spyOn>;
let rmSyncSpy: ReturnType<typeof vi.spyOn>;

const realCopyFileSync = fs.copyFileSync;
const realCpSync = fs.cpSync;
const realRmSync = fs.rmSync;
const actualFs = await vi.importActual<typeof import('fs')>('fs');
const realOpenSync = actualFs.openSync;
const realCloseSync = actualFs.closeSync;

const openSyncMock = fs.openSync as unknown as ReturnType<typeof vi.fn>;
const readSyncMock = fs.readSync as unknown as ReturnType<typeof vi.fn>;
const closeSyncMock = fs.closeSync as unknown as ReturnType<typeof vi.fn>;
let capturedOutput: string[] = [];
let capturedExitCodes: number[] = [];
let expectedExitCodes: number[] = [];

function formatDateForFilename(d: Date): string {
  return d.toISOString().replace(/[-:T]/g, '').slice(0, 15);
}

function setConfirmInput(answer: string): void {
  openSyncMock.mockReturnValue(77);
  closeSyncMock.mockImplementation((fd: number) => {
    if (fd !== 77) realCloseSync(fd);
  });
  if (answer.length === 0) {
    readSyncMock.mockReturnValue(0);
    return;
  }
  readSyncMock.mockImplementation((fd, buffer, offset, length) => {
    const payload = `${answer}\n`;
    const bytes = Buffer.from(payload, 'utf-8');
    bytes.copy(buffer, offset, 0, Math.min(bytes.length, length));
    return Math.min(bytes.length, length);
  });
}

function queueExec(plan: ExecResult): void {
  execQueue.push(plan);
}

function getOutput(): string {
  return capturedOutput.join('');
}

function runCli(argv: string[]): Promise<void> {
  process.argv = ['node', 'launchly', ...argv];
  vi.resetModules();
  return import('../index.js') as Promise<void>;
}

beforeEach(() => {
  execQueue = [];
  execCalls = [];
  unexpectedCalls = [];
  contractFailures = [];
  execFileSyncMock.mockClear();

  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'launchly-cli-ops-test-'));
  dataDir = path.join(tmpRoot, 'data');

  originalArgv = process.argv;
  originalDataDirEnv = process.env.LAUNCHLY_DATA_DIR;
  process.env.LAUNCHLY_DATA_DIR = dataDir;

  capturedOutput = [];
  capturedExitCodes = [];
  expectedExitCodes = [];

  consoleSpy = vi.spyOn(console, 'log').mockImplementation((...args: any[]) => {
    capturedOutput.push(args.map((arg) => (typeof arg === 'string' ? arg : String(arg))).join(' ') + '\n');
  });
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
    capturedOutput.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  });
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as any);
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((...args: any[]) => {
    capturedOutput.push(args.map((arg) => (typeof arg === 'string' ? arg : String(arg))).join(' ') + '\n');
  });
  exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    capturedExitCodes.push(code ?? 1);
    throw new Error(`Unexpected process.exit(${code})`);
  }) as any);

  openSyncMock.mockReset();
  readSyncMock.mockReset().mockReturnValue(0);
  closeSyncMock.mockReset().mockImplementation((fd: number) => realCloseSync(fd));
  openSyncMock.mockImplementation((target: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode) => {
    if (target === '/dev/stdin') {
      throw new Error('setConfirmInput() must be called before any confirmation path');
    }
    return realOpenSync(target, flags, mode);
  });

  copyFileSyncSpy = vi.spyOn(fs, 'copyFileSync').mockImplementation((...args: any[]) => {
    return realCopyFileSync(...args);
  });
  cpSyncSpy = vi.spyOn(fs, 'cpSync').mockImplementation((...args: any[]) => {
    return realCpSync(...args);
  });
  rmSyncSpy = vi.spyOn(fs, 'rmSync').mockImplementation((...args: any[]) => realRmSync(...args));
});

afterEach(() => {
  process.argv = originalArgv;
  if (originalDataDirEnv === undefined) delete process.env.LAUNCHLY_DATA_DIR;
  else process.env.LAUNCHLY_DATA_DIR = originalDataDirEnv;

  const strictExit = [...capturedExitCodes];
  const strictContractFailures = [...contractFailures];
  const strictUnexpectedCalls = [...unexpectedCalls];
  const strictQueue = [...execQueue];

  if (consoleSpy) consoleSpy.mockRestore();
  if (stdoutSpy) stdoutSpy.mockRestore();
  if (stderrSpy) stderrSpy.mockRestore();
  if (consoleErrorSpy) consoleErrorSpy.mockRestore();
  if (exitSpy) exitSpy.mockRestore();
  if (copyFileSyncSpy) copyFileSyncSpy.mockRestore();
  if (cpSyncSpy) cpSyncSpy.mockRestore();
  if (rmSyncSpy) rmSyncSpy.mockRestore();

  vi.resetModules();

  if (tmpRoot) {
    const realTmp = fs.realpathSync(tmpRoot);
    const realBase = fs.realpathSync(os.tmpdir());
    if (realTmp.startsWith(realBase + path.sep) || realTmp === realBase) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } else {
      throw new Error(`tmpRoot escaped os.tmpdir(): ${realTmp}`);
    }
  }

  if (strictQueue.length !== 0) {
    throw new Error(`Test ended with ${strictQueue.length} unconsumed execFileSync plan(s)`);
  }
  if (strictUnexpectedCalls.length !== 0) {
    throw new Error(
      `Test ended with ${strictUnexpectedCalls.length} unexpected execFileSync call(s): ` +
        strictUnexpectedCalls.map((c) => `${c.file} ${JSON.stringify(c.args)}`).join('; '),
    );
  }
  if (strictContractFailures.length !== 0) {
    throw new Error(
      `Test ended with ${strictContractFailures.length} execFileSync contract failure(s): ` +
        strictContractFailures.join('; '),
    );
  }
  if (strictExit.length !== expectedExitCodes.length) {
    throw new Error(
      `Test ended with ${strictExit.length} process.exit call(s): ${strictExit.join(', ')}. ` +
        `Expected ${expectedExitCodes.length}: ${expectedExitCodes.join(', ')}`,
    );
  }
  for (let i = 0; i < strictExit.length; i++) {
    if (strictExit[i] !== expectedExitCodes[i]) {
      throw new Error(`process.exit mismatch at index ${i}: got ${strictExit[i]}, expected ${expectedExitCodes[i]}`);
    }
  }
});

describe('CLI backup', () => {
  it('creates backup archive command including .env, launchly-data, and launchly-worker-data', async () => {
    const fixedNow = new Date('2026-01-01T10:20:30.123Z');
    const fixedTs = formatDateForFilename(fixedNow);
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);

    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(path.join(dataDir, 'launchly-data'), { recursive: true });
    fs.mkdirSync(path.join(dataDir, 'launchly-worker-data'), { recursive: true });
    fs.writeFileSync(path.join(dataDir, '.env'), [
      'LAUNCHLY_DB_PASSWORD=x',
      'LAUNCHLY_JWT_SECRET=jwt-secret',
      'LAUNCHLY_ENCRYPTION_KEY=encryption-secret',
      'LAUNCHLY_ENCRYPTION_PREVIOUS_KEYS=old-encryption-secret',
      'LAUNCHLY_GITHUB_APP_PRIVATE_KEY_BASE64=private-key-material',
      'LAUNCHLY_APP_PORT=8080',
      '',
    ].join('\n'), { mode: 0o600 });
    fs.writeFileSync(path.join(dataDir, 'launchly-data', 'app.data'), 'app');
    fs.writeFileSync(path.join(dataDir, 'launchly-worker-data', 'worker.data'), 'worker');
    fs.writeFileSync(path.join(dataDir, 'docker-compose.yml'), 'services:\n');

    const backupPath = path.join(dataDir, 'backups', `launchly-backup-${fixedTs}.tar.gz`);
    const tmpPath = path.join(dataDir, 'backups', `tmp_${fixedTs}`);
    queueExec({
      file: 'docker',
      args: ['compose', '-f', path.join(dataDir, 'docker-compose.yml'), 'exec', '-T', 'launchly-postgres', 'pg_dump', '-U', 'launchly', '-d', 'launchly', '--clean', '--if-exists', '--create'],
    });
    queueExec({
      file: 'docker',
      args: ['run', '--rm', '-v', 'launchly_launchly-data:/source:ro', '-v', `${tmpPath}:/backup`, 'alpine:3.20', 'tar', '-cf', '/backup/launchly-data.tar', '-C', '/source', '.'],
    });
    queueExec({
      file: 'docker',
      args: ['run', '--rm', '-v', 'launchly_launchly-worker-data:/source:ro', '-v', `${tmpPath}:/backup`, 'alpine:3.20', 'tar', '-cf', '/backup/launchly-worker-data.tar', '-C', '/source', '.'],
    });
    let archivedEnv = '';
    queueExec({
      file: 'tar',
      args: ['-czf', backupPath, '-C', tmpPath, '.'],
      sideEffect: () => {
        archivedEnv = fs.readFileSync(path.join(tmpPath, '.env'), 'utf-8');
        fs.writeFileSync(backupPath, 'archive\n');
      },
    });

    await runCli(['backup']);

    expect(execCalls).toHaveLength(4);
    expect(execCalls[0].file).toBe('docker');
    expect(execCalls[0].args).toEqual([
      'compose',
      '-f',
      path.join(dataDir, 'docker-compose.yml'),
      'exec',
      '-T',
      'launchly-postgres',
      'pg_dump',
      '-U',
      'launchly',
      '-d',
      'launchly',
      '--clean',
      '--if-exists',
      '--create',
    ]);
    expect(execCalls[3].file).toBe('tar');
    expect(execCalls[3].args).toEqual(['-czf', backupPath, '-C', tmpPath, '.']);

    expect(archivedEnv).toContain('LAUNCHLY_APP_PORT=8080');
    expect(archivedEnv).not.toContain('LAUNCHLY_DB_PASSWORD');
    expect(archivedEnv).not.toContain('LAUNCHLY_JWT_SECRET');
    expect(archivedEnv).not.toContain('LAUNCHLY_ENCRYPTION_KEY');
    expect(archivedEnv).not.toContain('LAUNCHLY_ENCRYPTION_PREVIOUS_KEYS');
    expect(archivedEnv).not.toContain('LAUNCHLY_GITHUB_APP_PRIVATE_KEY_BASE64');
    expect(execCalls[1].args).toContain('launchly_launchly-data:/source:ro');
    expect(execCalls[2].args).toContain('launchly_launchly-worker-data:/source:ro');

    expect(getOutput()).toContain(`正在创建备份：${backupPath}`);
    expect(getOutput()).toContain(`备份已生成：${backupPath}`);
    expect(fs.statSync(backupPath).mode & 0o777).toBe(0o600);
    expect(rmSyncSpy).toHaveBeenCalledWith(tmpPath, { recursive: true, force: true });

    vi.useRealTimers();
  });

  it('does not execute destructive operations when db dump fails', async () => {
    const fail = new Error('docker compose missing');
    fs.mkdirSync(dataDir, { recursive: true });
    queueExec({
      file: 'docker',
      args: ['compose', '-f', path.join(dataDir, 'docker-compose.yml'), 'exec', '-T', 'launchly-postgres', 'pg_dump', '-U', 'launchly', '-d', 'launchly', '--clean', '--if-exists', '--create'],
      throw: fail,
    });
    expectedExitCodes = [1];

    await expect(runCli(['backup'])).rejects.toBeInstanceOf(Error);
    expect(execCalls).toHaveLength(1);
    expect(execCalls[0].file).toBe('docker');
    expect(execCalls[0].args).toContain('pg_dump');
    expect(getOutput()).toContain('错误：导出数据库失败');
    expect(getOutput()).toContain('请确认 Launchly 已启动');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('CLI restore', () => {
  it('asks confirmation, and aborts when user refuses', async () => {
    const backupFile = path.join(dataDir, 'manual-backup.tar.gz');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(backupFile, 'backup');
    setConfirmInput('no');

    await runCli(['restore', backupFile]);

    expect(execCalls).toHaveLength(0);
    expect(getOutput()).toContain(`正在从备份恢复：${backupFile}`);
    expect(getOutput()).toContain('警告：此操作将覆盖现有数据。');
    expect(getOutput()).toContain('继续？[y/N] ');
    expect(getOutput()).toContain('已取消。');
    expect(openSyncMock).toHaveBeenCalledWith('/dev/stdin', 'r');
    expect(closeSyncMock).toHaveBeenCalledWith(77);
    expect(getOutput()).not.toContain('tar -xzf');
    expect(cpSyncSpy).not.toHaveBeenCalled();
  });

  it('restores db dump, .env, and both launchly volumes when --force', async () => {
    const backupFile = path.join(dataDir, 'manual-backup.tar.gz');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, '.env'), 'LAUNCHLY_DB_PASSWORD=old\n', { mode: 0o600 });
    fs.mkdirSync(path.join(dataDir, 'launchly-data'), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'launchly-data', 'old.data'), 'old-data');
    fs.mkdirSync(path.join(dataDir, 'launchly-worker-data'), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'launchly-worker-data', 'old-worker.data'), 'old-worker');
    fs.writeFileSync(path.join(dataDir, 'docker-compose.yml'), 'services:\n');
    fs.writeFileSync(backupFile, 'backup');

    const restoreDir = path.join(dataDir, 'restore_tmp');
    const backupDbFile = path.join(restoreDir, 'db_dump.sql');

    queueExec({
      file: 'tar',
      args: ['-xzf', backupFile, '-C', restoreDir],
      sideEffect: () => {
        fs.mkdirSync(restoreDir, { recursive: true });
        fs.writeFileSync(backupDbFile, 'CREATE TABLE test;');
        fs.writeFileSync(path.join(restoreDir, '.env'), 'LAUNCHLY_DB_PASSWORD=restored\nLAUNCHLY_JWT_SECRET=restored-jwt\nLAUNCHLY_ENCRYPTION_KEY=restored-key\n');
        fs.mkdirSync(path.join(restoreDir, 'launchly-data'), { recursive: true });
        fs.writeFileSync(path.join(restoreDir, 'launchly-data', 'restored.data'), 'restored-data');
        fs.mkdirSync(path.join(restoreDir, 'launchly-worker-data'), { recursive: true });
        fs.writeFileSync(path.join(restoreDir, 'launchly-worker-data', 'restored-worker.data'), 'restored-worker-data');
      },
    });
    queueExec({
      file: 'docker',
      args: ['compose', '-f', path.join(dataDir, 'docker-compose.yml'), 'exec', '-T', 'launchly-postgres', 'psql', '-U', 'launchly', '--set', 'ON_ERROR_STOP=on', '-d', 'postgres'],
      stdout: '',
    });

    await runCli(['restore', '--force', backupFile]);

    expect(execCalls).toHaveLength(2);
    expect(execCalls[1].file).toBe('docker');
    expect(execCalls[1].args).toContain('launchly-postgres');
    expect(execCalls[1].args).toContain('psql');
    expect(execCalls[1].args).toContain('-U');
    expect(execCalls[1].args).toContain('postgres');
    expect(execCalls[1].args).toContain('-d');
    expect(execCalls[1].args).toContain('launchly');
    expect(execCalls[1].options.stdio[0]).toEqual(expect.any(Number));
    expect(execCalls[1].options.stdio.slice(1)).toEqual(['inherit', 'inherit']);
    expect(cpSyncSpy).toHaveBeenCalledWith(path.join(restoreDir, 'launchly-data'), path.join(dataDir, 'launchly-data'), {
      recursive: true,
    });
    expect(cpSyncSpy).toHaveBeenCalledWith(
      path.join(restoreDir, 'launchly-worker-data'),
      path.join(dataDir, 'launchly-worker-data'),
      { recursive: true },
    );
    expect(fs.readFileSync(path.join(dataDir, '.env'), 'utf-8')).toContain('LAUNCHLY_DB_PASSWORD=old');
    expect(fs.readFileSync(path.join(dataDir, '.env'), 'utf-8')).toContain('LAUNCHLY_ENCRYPTION_KEY=restored-key');
    expect(fs.readFileSync(path.join(dataDir, 'launchly-data', 'restored.data'), 'utf-8')).toBe('restored-data');
    expect(fs.readFileSync(path.join(dataDir, 'launchly-worker-data', 'restored-worker.data'), 'utf-8')).toBe(
      'restored-worker-data',
    );
    expect(fs.existsSync(restoreDir)).toBe(false);
    expect(getOutput()).toContain(`正在从备份恢复：${backupFile}`);
    expect(getOutput()).toContain('恢复完成。');
  });

  it('validates backup file existence before doing any restore work', async () => {
    expectedExitCodes = [1];
    const backupFile = path.join(dataDir, 'missing-backup.tar.gz');

    await expect(runCli(['restore', backupFile])).rejects.toBeInstanceOf(Error);
    expect(execCalls).toHaveLength(0);
    expect(getOutput()).toContain(`错误：找不到备份文件：${backupFile}`);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('refuses a sanitized backup before touching the database when current secrets are missing', async () => {
    const backupFile = path.join(dataDir, 'sanitized-backup.tar.gz');
    const restoreDir = path.join(dataDir, 'restore_tmp');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, '.env'), 'LAUNCHLY_APP_PORT=8080\n', { mode: 0o600 });
    fs.writeFileSync(backupFile, 'backup');

    queueExec({
      file: 'tar',
      args: ['-xzf', backupFile, '-C', restoreDir],
      sideEffect: () => {
        fs.mkdirSync(restoreDir, { recursive: true });
        fs.writeFileSync(path.join(restoreDir, 'db_dump.sql'), 'DROP DATABASE launchly;');
        fs.writeFileSync(path.join(restoreDir, '.env'), 'LAUNCHLY_APP_PORT=9090\n');
      },
    });

    await expect(runCli(['restore', '--force', backupFile])).rejects.toThrow('数据库尚未修改');
    expect(execCalls).toHaveLength(1);
    expect(execCalls[0].file).toBe('tar');
    expect(fs.existsSync(restoreDir)).toBe(false);
  });
});

describe('CLI uninstall', () => {
  it('defaults to down -v and removes data directory after confirmation', async () => {
    const envPath = path.join(dataDir, '.env');
    const composePath = path.join(dataDir, 'docker-compose.yml');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(envPath, 'LAUNCHLY_DB_PASSWORD=x\n', { mode: 0o600 });
    fs.mkdirSync(path.join(dataDir, 'launchly-data'), { recursive: true });
    fs.writeFileSync(composePath, 'services:\n');
    fs.writeFileSync(path.join(dataDir, 'launchly-data', 'seed.txt'), 'old', { flag: 'w' });
    setConfirmInput('yes');

    queueExec({
      file: 'docker',
      args: ['compose', '-f', composePath, '--env-file', envPath, 'down', '-v'],
      options: { stdio: 'inherit' },
      stdout: '',
    });

    await runCli(['uninstall']);

    expect(execCalls).toHaveLength(1);
    expect(execCalls[0].file).toBe('docker');
    expect(execCalls[0].args).toEqual(['compose', '-f', composePath, '--env-file', envPath, 'down', '-v']);
    expect(execCalls[0].options).toEqual({ stdio: 'inherit' });
    expect(fs.existsSync(dataDir)).toBe(false);
    expect(getOutput()).toContain('Launchly 已卸载。');
    expect(getOutput()).toContain("请输入 'yes' 确认：");
    expect(rmSyncSpy).toHaveBeenCalledWith(dataDir, { recursive: true, force: true });
  });

  it('keeps local data and skips -v when --keep-data', async () => {
    const envPath = path.join(dataDir, '.env');
    const composePath = path.join(dataDir, 'docker-compose.yml');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(envPath, 'LAUNCHLY_DB_PASSWORD=x\n', { mode: 0o600 });
    fs.mkdirSync(path.join(dataDir, 'launchly-data'), { recursive: true });
    fs.writeFileSync(composePath, 'services:\n');
    fs.writeFileSync(path.join(dataDir, 'launchly-data', 'seed.txt'), 'old', { flag: 'w' });
    setConfirmInput('yes');

    queueExec({
      file: 'docker',
      args: ['compose', '-f', composePath, '--env-file', envPath, 'down'],
      options: { stdio: 'inherit' },
      stdout: '',
    });

    await runCli(['uninstall', '--keep-data']);

    expect(execCalls).toHaveLength(1);
    expect(execCalls[0].args).toEqual(['compose', '-f', composePath, '--env-file', envPath, 'down']);
    expect(execCalls[0].args).not.toContain('-v');
    expect(execCalls[0].options).toEqual({ stdio: 'inherit' });
    expect(fs.existsSync(dataDir)).toBe(true);
    expect(getOutput()).toContain('Launchly 已卸载。');
    expect(fs.existsSync(path.join(dataDir, 'launchly-data', 'seed.txt'))).toBe(true);
  });

  it('--force skips confirmation prompt and performs keep-data uninstall', async () => {
    const envPath = path.join(dataDir, '.env');
    const composePath = path.join(dataDir, 'docker-compose.yml');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(envPath, 'LAUNCHLY_DB_PASSWORD=x\n', { mode: 0o600 });
    fs.writeFileSync(composePath, 'services:\n');

    queueExec({
      file: 'docker',
      args: ['compose', '-f', composePath, '--env-file', envPath, 'down'],
      options: { stdio: 'inherit' },
      stdout: '',
    });

    await runCli(['uninstall', '--force', '--keep-data']);

    expect(openSyncMock).not.toHaveBeenCalled();
    expect(execCalls).toHaveLength(1);
    expect(execCalls[0].args).toEqual(['compose', '-f', composePath, '--env-file', envPath, 'down']);
    expect(execCalls[0].options).toEqual({ stdio: 'inherit' });
    expect(fs.existsSync(dataDir)).toBe(true);
    expect(getOutput()).toContain('Launchly 已卸载。');
  });
});
