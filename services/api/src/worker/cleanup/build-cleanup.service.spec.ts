/* eslint-disable @typescript-eslint/no-explicit-any */
import * as fs from 'fs';
import { Logger } from '@nestjs/common';
import { BuildCleanupService } from './build-cleanup.service';

// ─── fs mock (per-method, default safe values; test installs stricter impls) ─

jest.mock('fs', () => {
  const real = jest.requireActual('fs');
  const safe = () => jest.fn();
  const overrides: any = {
    existsSync: safe(),
    readdirSync: safe(),
    statSync: safe(),
    rmSync: safe(),
  };
  (real as any).__launchlyFsOverrides = overrides;
  return new Proxy(real, {
    get(target, prop) {
      if (prop in overrides) return overrides[prop as string];
      return (target as any)[prop];
    },
  });
});

const fsMock = ((fs as any).__launchlyFsOverrides as {
  existsSync: jest.Mock;
  readdirSync: jest.Mock;
  statSync: jest.Mock;
  rmSync: jest.Mock;
});

const ORIGINAL_ENV = { ...process.env };

const unexpectedSync = (name: string) => (...args: unknown[]) => {
  throw new Error(`Unexpected unconfigured fs.${name} call: ${JSON.stringify(args)}`);
};

function resetFsMock() {
  for (const fn of Object.values(fsMock)) {
    fn.mockReset();
  }
}

beforeEach(() => {
  resetFsMock();
  fsMock.existsSync.mockImplementation(unexpectedSync('existsSync'));
  fsMock.readdirSync.mockImplementation(unexpectedSync('readdirSync'));
  fsMock.statSync.mockImplementation(unexpectedSync('statSync'));
  fsMock.rmSync.mockImplementation(unexpectedSync('rmSync'));
  delete process.env.LAUNCHLY_CLEANUP_MAX_AGE_DAYS;
});

afterEach(() => {
  if (ORIGINAL_ENV.LAUNCHLY_CLEANUP_MAX_AGE_DAYS === undefined) {
    delete process.env.LAUNCHLY_CLEANUP_MAX_AGE_DAYS;
  } else {
    process.env.LAUNCHLY_CLEANUP_MAX_AGE_DAYS = ORIGINAL_ENV.LAUNCHLY_CLEANUP_MAX_AGE_DAYS;
  }
  jest.restoreAllMocks();
});

// ─── Helpers ──────────────────────────────────────────────────────────────

const BUILD_ROOT = '/tmp/launchly-builds';
const DAY = 24 * 60 * 60 * 1000;

function fixedNow() {
  return new Date('2026-08-13T12:00:00.000Z').getTime();
}

function buildDirent(name: string, isDir: boolean) {
  return { name, isDirectory: () => isDir, isFile: () => !isDir };
}

function statFor(mtimeMs: number) {
  return { mtimeMs };
}

function makeService() {
  return new BuildCleanupService();
}

function installLogger() {
  const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  return { logSpy, warnSpy };
}

function restoreLogger(spies: { logSpy: jest.SpyInstance; warnSpy: jest.SpyInstance }) {
  spies.logSpy.mockRestore();
  spies.warnSpy.mockRestore();
}

function allOutput(spies: { logSpy: jest.SpyInstance; warnSpy: jest.SpyInstance }): string {
  return [...spies.logSpy.mock.calls, ...spies.warnSpy.mock.calls].map(c => String(c[0])).join('');
}

function allowRemove() {
  fsMock.rmSync.mockImplementation(() => undefined);
}

// ─── A. BUILD_ROOT missing ─────────────────────────────────────────────────

describe('BuildCleanupService.cleanupOldBuilds - BUILD_ROOT missing', () => {
  it('returns immediately when BUILD_ROOT does not exist (no readdir, no log)', () => {
    const svc = makeService();
    const spies = installLogger();
    fsMock.existsSync.mockReturnValue(false);
    svc.cleanupOldBuilds();
    expect(fsMock.readdirSync).not.toHaveBeenCalled();
    expect(fsMock.statSync).not.toHaveBeenCalled();
    expect(fsMock.rmSync).not.toHaveBeenCalled();
    expect(allOutput(spies)).toBe('');
    restoreLogger(spies);
  });
});

// ─── B. readdirSync error ─────────────────────────────────────────────────

describe('BuildCleanupService.cleanupOldBuilds - readdirSync error', () => {
  it('warns and returns when readdirSync throws', () => {
    const svc = makeService();
    const spies = installLogger();
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readdirSync.mockImplementationOnce(() => { throw new Error('EACCES'); });
    svc.cleanupOldBuilds();
    const out = allOutput(spies);
    expect(out).toContain('Failed to list build root');
    expect(out).toContain('EACCES');
    expect(fsMock.statSync).not.toHaveBeenCalled();
    restoreLogger(spies);
  });
});

// ─── C. Directories only processed ───────────────────────────────────────

describe('BuildCleanupService.cleanupOldBuilds - directory filtering', () => {
  it('skips non-directory entries (regular files are not rmSync-ed)', () => {
    const svc = makeService();
    const spies = installLogger();
    const now = fixedNow();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readdirSync.mockReturnValueOnce([
      buildDirent('a-file.txt', false),
      buildDirent('not-a-dir', false),
    ] as any);
    svc.cleanupOldBuilds();
    expect(fsMock.statSync).not.toHaveBeenCalled();
    expect(fsMock.rmSync).not.toHaveBeenCalled();
    expect(allOutput(spies)).toBe('');
    nowSpy.mockRestore();
    restoreLogger(spies);
  });

  it('mixes directories and files: files ignored, directories processed', () => {
    const svc = makeService();
    const spies = installLogger();
    const now = fixedNow();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readdirSync.mockReturnValueOnce([
      buildDirent('regular.txt', false),
      buildDirent('old-build', true),
      buildDirent('another-file', false),
      buildDirent('new-build', true),
    ] as any);
    fsMock.statSync.mockImplementation(((p: any) => {
      if (p === `${BUILD_ROOT}/old-build`) return statFor(now - 8 * DAY);
      if (p === `${BUILD_ROOT}/new-build`) return statFor(now - 1 * DAY);
      return statFor(now);
    }) as any);
    allowRemove();
    svc.cleanupOldBuilds();
    expect(fsMock.rmSync).toHaveBeenCalledTimes(1);
    expect(fsMock.rmSync).toHaveBeenCalledWith(`${BUILD_ROOT}/old-build`, { recursive: true, force: true });
    expect(fsMock.statSync).toHaveBeenCalledWith(`${BUILD_ROOT}/old-build`);
    expect(fsMock.statSync).toHaveBeenCalledWith(`${BUILD_ROOT}/new-build`);
    restoreLogger(spies);
    nowSpy.mockRestore();
  });
});

// ─── D. Cutoff boundary ──────────────────────────────────────────────────

describe('BuildCleanupService.cleanupOldBuilds - cutoff boundary', () => {
  it('directory with mtime strictly older than cutoff is removed', () => {
    const svc = makeService();
    const spies = installLogger();
    const now = fixedNow();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readdirSync.mockReturnValueOnce([buildDirent('old', true)] as any);
    fsMock.statSync.mockReturnValueOnce(statFor(now - 8 * DAY));
    allowRemove();
    svc.cleanupOldBuilds();
    expect(fsMock.rmSync).toHaveBeenCalledWith(`${BUILD_ROOT}/old`, { recursive: true, force: true });
    expect(fsMock.statSync).toHaveBeenCalledWith(`${BUILD_ROOT}/old`);
    nowSpy.mockRestore();
    restoreLogger(spies);
  });

  it('directory with mtime exactly at cutoff is KEPT (strict < comparison)', () => {
    const svc = makeService();
    const spies = installLogger();
    const now = fixedNow();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readdirSync.mockReturnValueOnce([buildDirent('exact', true)] as any);
    fsMock.statSync.mockReturnValueOnce(statFor(now - 7 * DAY));
    svc.cleanupOldBuilds();
    expect(fsMock.rmSync).not.toHaveBeenCalled();
    expect(fsMock.statSync).toHaveBeenCalledWith(`${BUILD_ROOT}/exact`);
    nowSpy.mockRestore();
    restoreLogger(spies);
  });

  it('directory with mtime newer than cutoff is kept', () => {
    const svc = makeService();
    const spies = installLogger();
    const now = fixedNow();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readdirSync.mockReturnValueOnce([buildDirent('fresh', true)] as any);
    fsMock.statSync.mockReturnValueOnce(statFor(now - 1 * DAY));
    svc.cleanupOldBuilds();
    expect(fsMock.rmSync).not.toHaveBeenCalled();
    nowSpy.mockRestore();
    restoreLogger(spies);
  });
});

// ─── E. Per-entry error isolation ─────────────────────────────────────────

describe('BuildCleanupService.cleanupOldBuilds - per-entry error isolation', () => {
  it('statSync throws on one entry: warn and continue processing other entries', () => {
    const svc = makeService();
    const spies = installLogger();
    const now = fixedNow();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readdirSync.mockReturnValueOnce([
      buildDirent('bad', true),
      buildDirent('good', true),
    ] as any);
    fsMock.statSync.mockImplementation(((p: any) => {
      if (p === `${BUILD_ROOT}/bad`) throw new Error('ESTALE');
      return statFor(now - 8 * DAY);
    }) as any);
    allowRemove();
    svc.cleanupOldBuilds();
    const out = allOutput(spies);
    expect(out).toContain('Failed to clean bad: ESTALE');
    expect(fsMock.rmSync).toHaveBeenCalledTimes(1);
    expect(fsMock.rmSync).toHaveBeenCalledWith(`${BUILD_ROOT}/good`, { recursive: true, force: true });
    expect(out).toContain('Build cleanup: removed 1 directories');
    nowSpy.mockRestore();
    restoreLogger(spies);
  });

  it('rmSync throws on one entry: warn, do NOT count, continue processing', () => {
    const svc = makeService();
    const spies = installLogger();
    const now = fixedNow();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readdirSync.mockReturnValueOnce([
      buildDirent('rmfail', true),
      buildDirent('good', true),
    ] as any);
    fsMock.statSync.mockReturnValue(statFor(now - 8 * DAY));
    fsMock.rmSync.mockImplementation(((p: any) => {
      if (p === `${BUILD_ROOT}/rmfail`) throw new Error('EBUSY');
    }) as any);
    svc.cleanupOldBuilds();
    const out = allOutput(spies);
    expect(out).toContain('Failed to clean rmfail: EBUSY');
    expect(out).toContain('Build cleanup: removed 1 directories');
    nowSpy.mockRestore();
    restoreLogger(spies);
  });

  it('per-entry failure does not abort the whole batch', () => {
    const svc = makeService();
    const spies = installLogger();
    const now = fixedNow();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readdirSync.mockReturnValueOnce([
      buildDirent('a', true),
      buildDirent('b', true),
      buildDirent('c', true),
    ] as any);
    fsMock.statSync.mockImplementation(((p: any) => {
      if (p === `${BUILD_ROOT}/b`) throw new Error('crash');
      return statFor(now - 10 * DAY);
    }) as any);
    allowRemove();
    svc.cleanupOldBuilds();
    expect(fsMock.rmSync).toHaveBeenCalledWith(`${BUILD_ROOT}/a`, { recursive: true, force: true });
    expect(fsMock.rmSync).toHaveBeenCalledWith(`${BUILD_ROOT}/c`, { recursive: true, force: true });
    expect(allOutput(spies)).toContain('Build cleanup: removed 2 directories');
    nowSpy.mockRestore();
    restoreLogger(spies);
  });
});

// ─── F. Log behavior ─────────────────────────────────────────────────────

describe('BuildCleanupService.cleanupOldBuilds - log gating', () => {
  it('logs "removed N directories older than D days" exactly once when at least one is deleted', () => {
    const svc = makeService();
    const spies = installLogger();
    const now = fixedNow();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readdirSync.mockReturnValueOnce([
      buildDirent('a', true),
      buildDirent('b', true),
      buildDirent('c', true),
    ] as any);
    fsMock.statSync.mockReturnValue(statFor(now - 8 * DAY));
    allowRemove();
    svc.cleanupOldBuilds();
    const out = allOutput(spies);
    expect(out).toContain('Build cleanup: removed 3 directories older than 7 days');
    nowSpy.mockRestore();
    restoreLogger(spies);
  });

  it('does NOT log success when zero directories are deleted', () => {
    const svc = makeService();
    const spies = installLogger();
    const now = fixedNow();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readdirSync.mockReturnValueOnce([
      buildDirent('fresh1', true),
      buildDirent('fresh2', true),
    ] as any);
    fsMock.statSync.mockReturnValue(statFor(now - 1 * DAY));
    svc.cleanupOldBuilds();
    expect(allOutput(spies)).toBe('');
    nowSpy.mockRestore();
    restoreLogger(spies);
  });
});

// ─── G. maxAgeDays env handling ─────────────────────────────────────────

describe('BuildCleanupService - maxAgeDays env var read at construction', () => {
  it('uses default 7 when env is unset', () => {
    const svc = makeService();
    const spies = installLogger();
    const now = fixedNow();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readdirSync.mockReturnValueOnce([buildDirent('old', true)] as any);
    fsMock.statSync.mockReturnValueOnce(statFor(now - 7 * DAY));
    svc.cleanupOldBuilds();
    expect(fsMock.rmSync).not.toHaveBeenCalled();
    nowSpy.mockRestore();
    restoreLogger(spies);
  });

  it('respects custom LAUNCHLY_CLEANUP_MAX_AGE_DAYS=14', () => {
    process.env.LAUNCHLY_CLEANUP_MAX_AGE_DAYS = '14';
    const svc = makeService();
    const spies = installLogger();
    const now = fixedNow();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readdirSync.mockReturnValueOnce([
      buildDirent('8day', true),
      buildDirent('15day', true),
    ] as any);
    fsMock.statSync.mockImplementation(((p: any) => {
      if (p === `${BUILD_ROOT}/8day`) return statFor(now - 8 * DAY);
      if (p === `${BUILD_ROOT}/15day`) return statFor(now - 15 * DAY);
      return statFor(now);
    }) as any);
    allowRemove();
    svc.cleanupOldBuilds();
    expect(fsMock.rmSync).toHaveBeenCalledTimes(1);
    expect(fsMock.rmSync).toHaveBeenCalledWith(`${BUILD_ROOT}/15day`, { recursive: true, force: true });
    expect(allOutput(spies)).toContain('Build cleanup: removed 1 directories older than 14 days');
    nowSpy.mockRestore();
    restoreLogger(spies);
  });

  it('LAUNCHLY_CLEANUP_MAX_AGE_DAYS=0 keeps mtime === cutoff (strict <); mtime older by 1ms is removed', () => {
    process.env.LAUNCHLY_CLEANUP_MAX_AGE_DAYS = '0';
    const svc = makeService();
    const spies = installLogger();
    const now = fixedNow();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readdirSync.mockReturnValueOnce([buildDirent('fresh', true)] as any);
    // mtime = now (not less than cutoff = now - 0 = now) — kept
    fsMock.statSync.mockReturnValueOnce(statFor(now));
    svc.cleanupOldBuilds();
    expect(fsMock.rmSync).not.toHaveBeenCalled();
    // Now a 1ms older directory IS removed
    fsMock.statSync.mockReturnValueOnce(statFor(now - 1));
    fsMock.readdirSync.mockReturnValueOnce([buildDirent('slightly-older', true)] as any);
    allowRemove();
    svc.cleanupOldBuilds();
    expect(fsMock.rmSync).toHaveBeenCalledWith(`${BUILD_ROOT}/slightly-older`, { recursive: true, force: true });
    nowSpy.mockRestore();
    restoreLogger(spies);
  });

  it('LAUNCHLY_CLEANUP_MAX_AGE_DAYS=-5 (negative): cutoff is in the future, so all mtimes satisfy mtime < cutoff and old directories ARE removed (current behavior)', () => {
    process.env.LAUNCHLY_CLEANUP_MAX_AGE_DAYS = '-5';
    const svc = makeService();
    const spies = installLogger();
    const now = fixedNow();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readdirSync.mockReturnValueOnce([buildDirent('current', true)] as any);
    fsMock.statSync.mockReturnValueOnce(statFor(now));
    allowRemove();
    svc.cleanupOldBuilds();
    // Negative maxAgeDays makes the cutoff in the future; mtime < cutoff is true.
    expect(fsMock.rmSync).toHaveBeenCalledWith(`${BUILD_ROOT}/current`, { recursive: true, force: true });
    nowSpy.mockRestore();
    restoreLogger(spies);
  });

  it('LAUNCHLY_CLEANUP_MAX_AGE_DAYS=NaN (non-numeric): cutoff = now - NaN = NaN; mtime < NaN is always false, nothing is removed (current behavior)', () => {
    process.env.LAUNCHLY_CLEANUP_MAX_AGE_DAYS = 'not-a-number';
    const svc = makeService();
    const spies = installLogger();
    const now = fixedNow();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readdirSync.mockReturnValueOnce([buildDirent('ancient', true)] as any);
    fsMock.statSync.mockReturnValueOnce(statFor(now - 365 * DAY));
    svc.cleanupOldBuilds();
    expect(fsMock.rmSync).not.toHaveBeenCalled();
    nowSpy.mockRestore();
    restoreLogger(spies);
  });

  it('LAUNCHLY_CLEANUP_MAX_AGE_DAYS=7days (trailing chars): parsed as 7 (current behavior)', () => {
    process.env.LAUNCHLY_CLEANUP_MAX_AGE_DAYS = '7days';
    const svc = makeService();
    const spies = installLogger();
    const now = fixedNow();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readdirSync.mockReturnValueOnce([buildDirent('old', true)] as any);
    fsMock.statSync.mockReturnValueOnce(statFor(now - 8 * DAY));
    allowRemove();
    svc.cleanupOldBuilds();
    expect(fsMock.rmSync).toHaveBeenCalledWith(`${BUILD_ROOT}/old`, { recursive: true, force: true });
    nowSpy.mockRestore();
    restoreLogger(spies);
  });

  it('changing LAUNCHLY_CLEANUP_MAX_AGE_DAYS after construction has no effect (constructor-time read)', () => {
    const svc = makeService();
    const spies = installLogger();
    const now = fixedNow();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readdirSync.mockReturnValueOnce([buildDirent('old', true)] as any);
    fsMock.statSync.mockReturnValueOnce(statFor(now - 8 * DAY));
    allowRemove();
    process.env.LAUNCHLY_CLEANUP_MAX_AGE_DAYS = '30';
    svc.cleanupOldBuilds();
    // The service captured 7 at construction time; the env change doesn't take effect.
    expect(fsMock.rmSync).toHaveBeenCalledWith(`${BUILD_ROOT}/old`, { recursive: true, force: true });
    expect(allOutput(spies)).toContain('Build cleanup: removed 1 directories older than 7 days');
    nowSpy.mockRestore();
    restoreLogger(spies);
  });
});

// ─── H. Does not touch real /tmp ─────────────────────────────────────────

describe('BuildCleanupService - never reaches real /tmp/launchly-builds', () => {
  it('does not call any real fs function on the production BUILD_ROOT (current behavior)', () => {
    const svc = makeService();
    const spies = installLogger();
    fsMock.existsSync.mockReturnValue(false);
    svc.cleanupOldBuilds();
    expect(fsMock.readdirSync).not.toHaveBeenCalled();
    expect(fsMock.statSync).not.toHaveBeenCalled();
    expect(fsMock.rmSync).not.toHaveBeenCalled();
    expect(allOutput(spies)).toBe('');
    restoreLogger(spies);
  });
});
