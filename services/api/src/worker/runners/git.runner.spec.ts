/* eslint-disable @typescript-eslint/no-explicit-any */
import * as fs from 'fs';
import { Logger } from '@nestjs/common';
import { GitRunner } from './git.runner';
import { RunnerContext } from './runner.factory';

// ─── fs mock (per-method, default safe values; test installs stricter impls) ─
// We mock only the methods GitRunner uses. The default returns safe values so
// Prisma's own module initialization can call fs.existsSync etc. without
// throwing. Each test installs specific mock implementations as needed.

jest.mock('fs', () => {
  const real = jest.requireActual('fs');
  const safe = () => jest.fn();
  const overrides: any = {
    existsSync: safe(),
    rmSync: safe(),
    mkdirSync: safe(),
    writeFileSync: safe(),
    unlinkSync: safe(),
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
  rmSync: jest.Mock;
  mkdirSync: jest.Mock;
  writeFileSync: jest.Mock;
  unlinkSync: jest.Mock;
});

const unexpectedSync = (name: string) => (...args: unknown[]) => {
  throw new Error(`Unexpected unconfigured fs.${name} call: ${JSON.stringify(args)}`);
};

let warnSpy: jest.SpyInstance;
const originalGithubBindings = process.env.LAUNCHLY_GITHUB_INSTALLATION_BINDINGS;

beforeEach(() => {
  process.env.LAUNCHLY_GITHUB_INSTALLATION_BINDINGS = JSON.stringify({ 'inst-1': 'ws-1' });
  for (const fn of Object.values(fsMock)) {
    fn.mockReset();
  }
  fsMock.existsSync.mockImplementation(unexpectedSync('existsSync'));
  fsMock.rmSync.mockReturnValue(undefined);
  fsMock.mkdirSync.mockImplementation(unexpectedSync('mkdirSync'));
  fsMock.writeFileSync.mockImplementation(unexpectedSync('writeFileSync'));
  fsMock.unlinkSync.mockImplementation(unexpectedSync('unlinkSync'));
  warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  warnSpy.mockRestore();
  if (originalGithubBindings === undefined) delete process.env.LAUNCHLY_GITHUB_INSTALLATION_BINDINGS;
  else process.env.LAUNCHLY_GITHUB_INSTALLATION_BINDINGS = originalGithubBindings;
});

// ─── Test double builders ──────────────────────────────────────────────────

function makeContext(over: Partial<RunnerContext> = {}): RunnerContext {
  return {
    taskType: 'REPO_CLONE',
    refId: 'deploy-1',
    payload: { projectId: 'proj-1', repositoryUrl: 'https://github.com/acme/app.git', branch: 'main' },
    stageLogCallback: jest.fn(async () => undefined),
    ...over,
  };
}

function makeDeps(over: any = {}) {
  const unexpectedAsync = (name: string) => jest.fn(async (...args: unknown[]) => {
    throw new Error(`Unexpected unconfigured ${name} call: ${JSON.stringify(args)}`);
  });
  const executor: any = { execFile: unexpectedAsync('executor.execFile') };
  const prisma: any = {
    project: { findUnique: unexpectedAsync('prisma.project.findUnique') },
    repositoryCredential: { findUnique: unexpectedAsync('prisma.repositoryCredential.findUnique') },
  };
  const secrets: any = {
    decrypt: jest.fn((...args: unknown[]) => {
      throw new Error(`Unexpected unconfigured secrets.decrypt call: ${JSON.stringify(args)}`);
    }),
  };
  const githubApp: any = { installationToken: unexpectedAsync('githubApp.installationToken') };
  return { executor, prisma, secrets, githubApp, ...over };
}

function makeRunner(deps: any) {
  return new GitRunner(deps.executor, deps.prisma, deps.secrets, deps.githubApp);
}

const PUBLIC_URL = 'https://github.com/acme/app.git';

// ─── A. Input gate ────────────────────────────────────────────────────────

describe('GitRunner.execute - input gate rejects before any side effect', () => {
  it('rejects when repositoryUrl is missing and touches no fs/Prisma/secret/githubApp/executor', async () => {
    const deps = makeDeps();
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext({ payload: { projectId: 'proj-1', branch: 'main' } }));
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(-1);
    expect(result.errorMessage).toBe('仓库 URL / branch / commit 非法');
    expect(result.stderr).toBe('仓库 URL / branch / commit 非法');
    expect(fsMock.existsSync).not.toHaveBeenCalled();
    expect(fsMock.rmSync).not.toHaveBeenCalled();
    expect(fsMock.mkdirSync).not.toHaveBeenCalled();
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
    expect(deps.executor.execFile).not.toHaveBeenCalled();
    expect(deps.prisma.project.findUnique).not.toHaveBeenCalled();
    expect(deps.prisma.repositoryCredential.findUnique).not.toHaveBeenCalled();
    expect(deps.secrets.decrypt).not.toHaveBeenCalled();
    expect(deps.githubApp.installationToken).not.toHaveBeenCalled();
  });

  it('rejects when branch contains a NUL byte', async () => {
    const deps = makeDeps();
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext({ payload: { projectId: 'proj-1', repositoryUrl: PUBLIC_URL, branch: 'main\0bad' } }));
    expect(result.success).toBe(false);
    // KI-032 修复后：caller 输入校验失败统一抛 '仓库 URL / branch / commit 非法'。
    expect(result.errorMessage).toBe('仓库 URL / branch / commit 非法');
    expect(fsMock.mkdirSync).not.toHaveBeenCalled();
    expect(deps.executor.execFile).not.toHaveBeenCalled();
  });

  it('rejects when branch contains CR or LF', async () => {
    const deps = makeDeps();
    const runner = makeRunner(deps);
    const r1 = await runner.execute(makeContext({ payload: { projectId: 'proj-1', repositoryUrl: PUBLIC_URL, branch: 'ma\rbad' } }));
    const r2 = await runner.execute(makeContext({ payload: { projectId: 'proj-1', repositoryUrl: PUBLIC_URL, branch: 'ma\nbad' } }));
    expect(r1.success).toBe(false);
    expect(r2.success).toBe(false);
    expect(deps.executor.execFile).not.toHaveBeenCalled();
  });

  it('rejects when branch is exactly 256 chars and accepts 255 (KI-032 caller input gate)', async () => {
    const deps = makeDeps();
    const runner = makeRunner(deps);
    // 255 chars → accepted
    fsMock.existsSync.mockReturnValue(false);
    fsMock.mkdirSync.mockImplementation(() => undefined);
    deps.executor.execFile.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 });
    const ok = await runner.execute(makeContext({ payload: { projectId: 'proj-1', repositoryUrl: PUBLIC_URL, branch: 'a'.repeat(255) } }));
    expect(ok).toEqual({ success: true, stdout: '', stderr: '', exitCode: 0, errorMessage: '' });
    expect(deps.executor.execFile).toHaveBeenCalledTimes(1);
    // 256 chars → rejected (KI-032)
    const bad = await runner.execute(makeContext({ payload: { projectId: 'proj-1', repositoryUrl: PUBLIC_URL, branch: 'a'.repeat(256) } }));
    expect(bad.success).toBe(false);
    expect(bad.errorMessage).toBe('仓库 URL / branch / commit 非法');
    expect(fsMock.mkdirSync).toHaveBeenCalledTimes(1);
  });

  it('rejects when commitSha contains NUL/CR/LF or exceeds 255 chars (KI-032 caller input gate)', async () => {
    const deps = makeDeps();
    const runner = makeRunner(deps);
    for (const bad of ['abc\0def', 'abc\rdef', 'abc\ndef', 'a'.repeat(256)]) {
      const result = await runner.execute(makeContext({ payload: { projectId: 'proj-1', repositoryUrl: PUBLIC_URL, branch: 'main', commitSha: bad } }));
      expect(result.success).toBe(false);
      expect(result.errorMessage).toBe('仓库 URL / branch / commit 非法');
    }
    expect(deps.executor.execFile).not.toHaveBeenCalled();
  });

  it('rejects when sourceType is not GIT_PUBLIC / GITHUB_APP / DEPLOY_KEY (after creating the workDir)', async () => {
    const deps = makeDeps();
    fsMock.existsSync.mockReturnValueOnce(false); // workDir missing
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext({ payload: { projectId: 'proj-1', repositoryUrl: PUBLIC_URL, branch: 'main', sourceType: 'WAT' } }));
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('不支持的 Git 源类型: WAT');
    // workDir rm + mkdir were called; clone was not
    expect(fsMock.mkdirSync).toHaveBeenCalledTimes(1);
    expect(deps.executor.execFile).not.toHaveBeenCalled();
    expect(deps.prisma.project.findUnique).not.toHaveBeenCalled();
  });

  it('uses the default main branch and empty projectId fallback when both fields are omitted', async () => {
    const deps = makeDeps();
    fsMock.existsSync.mockReturnValueOnce(false);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    deps.executor.execFile.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 });
    const runner = makeRunner(deps);

    const result = await runner.execute(makeContext({ payload: { repositoryUrl: PUBLIC_URL } }));

    expect(result.success).toBe(true);
    expect(deps.executor.execFile.mock.calls[0][1]).toEqual([
      'clone', '--depth', '1', '--branch', 'main', '--', PUBLIC_URL, '.',
    ]);
  });
});

// ─── B. GIT_PUBLIC ─────────────────────────────────────────────────────────

describe('GitRunner.execute - GIT_PUBLIC path', () => {
  it('when workDir does not exist: skips rm, calls mkdir(0700) under task-isolated work-{refId}, clones with exact argv (KI-034)', async () => {
    const deps = makeDeps();
    fsMock.existsSync.mockReturnValueOnce(false);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    deps.executor.execFile.mockResolvedValueOnce({ stdout: 'cloned ok', stderr: '', exitCode: 0 });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('cloned ok');
    expect(result.stderr).toBe('');
    expect(fsMock.rmSync).toHaveBeenCalledWith('/tmp/launchly-builds/deploy-1/.git', { recursive: true, force: true });
    // KI-034：任务专属子目录 work-{refId}，避免并发串扰。
    expect(fsMock.mkdirSync).toHaveBeenCalledWith('/tmp/launchly-builds/deploy-1', { recursive: true, mode: 0o700 });
    const call = deps.executor.execFile.mock.calls[0];
    expect(call[0]).toBe('git');
    expect(call[1]).toEqual(['clone', '--depth', '1', '--branch', 'main', '--', PUBLIC_URL, '.']);
    expect(call[2]).toEqual({ cwd: '/tmp/launchly-builds/deploy-1', timeout: 300, env: undefined });
  });

  it('when workDir exists: removes it before cloning and strips .git after success', async () => {
    const deps = makeDeps();
    fsMock.existsSync.mockReturnValueOnce(true);
    fsMock.rmSync.mockReturnValueOnce(undefined);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    deps.executor.execFile.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(true);
    expect(fsMock.rmSync).toHaveBeenCalledWith('/tmp/launchly-builds/deploy-1', { recursive: true, force: true });
    expect(fsMock.rmSync).toHaveBeenCalledWith('/tmp/launchly-builds/deploy-1/.git', { recursive: true, force: true });
    expect(fsMock.mkdirSync).toHaveBeenCalledTimes(1);
  });

  it('sanitizes stdout/stderr from a successful clone (CommandExecutor.sanitize is real)', async () => {
    const deps = makeDeps();
    fsMock.existsSync.mockReturnValueOnce(false);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    deps.executor.execFile.mockResolvedValueOnce({ stdout: 'connected with password=hunter2', stderr: 'leaked token=ghp_abcdefghijklmnopqrstuvwxyz', exitCode: 0 });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(true);
    expect(result.stdout).not.toContain('hunter2');
    expect(result.stdout).toContain('[REDACTED]');
    expect(result.stderr).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz');
    expect(result.stderr).toContain('[REDACTED]');
  });

  it('non-zero exit: returns failure with sanitized stdout/stderr and propagates exit code', async () => {
    const deps = makeDeps();
    fsMock.existsSync.mockReturnValueOnce(false);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    deps.executor.execFile.mockResolvedValueOnce({ stdout: 'auth fail password=hunter2', stderr: 'remote: bad token=ghp_zzzzzzzzzzzzzzzzzzzzz', exitCode: 128 });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(128);
    expect(result.errorMessage).toBe('Git clone 失败');
    expect(result.stdout).not.toContain('hunter2');
    expect(result.stderr).not.toContain('ghp_zzzzzzzzzzzzzzzzzzzzz');
  });

  it('executor throws: returns failure with the original error message', async () => {
    const deps = makeDeps();
    fsMock.existsSync.mockReturnValueOnce(false);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    deps.executor.execFile.mockRejectedValueOnce(new Error('ENOSPC: no space left on device'));
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('ENOSPC: no space left on device');
  });

  it('executor throws a value without a message: uses the generic clone failure', async () => {
    const deps = makeDeps();
    fsMock.existsSync.mockReturnValueOnce(false);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    deps.executor.execFile.mockRejectedValueOnce({ code: 'UNKNOWN' });
    const runner = makeRunner(deps);

    const result = await runner.execute(makeContext());

    expect(result).toEqual({
      success: false,
      stdout: '',
      stderr: 'Git clone 失败',
      exitCode: -1,
      errorMessage: 'Git clone 失败',
    });
  });

  it('sanitizes sensitive thrown messages in both stderr and errorMessage', async () => {
    const deps = makeDeps();
    fsMock.existsSync.mockReturnValueOnce(false);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    deps.executor.execFile.mockRejectedValueOnce(new Error('token=plain-secret'));
    const runner = makeRunner(deps);

    const result = await runner.execute(makeContext());

    expect(result.stderr).toBe('token=[REDACTED]');
    expect(result.errorMessage).toBe('token=[REDACTED]');
  });

  it('commitSha present: clone + fetch + detached checkout (FETCH_HEAD) + HEAD verification are called in order with exact argv (KI-033)', async () => {
    // KI-033 修复后：commitSha 走 fail-closed 路径。
    //   1) clone
    //   2) git fetch --depth 1 origin <commitSha
    //   3) git checkout --detach FETCH_HEAD
    //   4) git rev-parse HEAD 用于核对实际 HEAD；测试中返回与请求一致以保持 success。
    const deps = makeDeps();
    fsMock.existsSync.mockReturnValueOnce(false);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    deps.executor.execFile
      .mockResolvedValueOnce({ stdout: 'cloned', stderr: '', exitCode: 0 }) // clone
      .mockResolvedValueOnce({ stdout: 'fetched', stderr: '', exitCode: 0 }) // fetch
      .mockResolvedValueOnce({ stdout: 'switched', stderr: '', exitCode: 0 }) // checkout FETCH_HEAD
      .mockResolvedValueOnce({ stdout: 'abc1234', stderr: '', exitCode: 0 }); // rev-parse HEAD
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext({ payload: { projectId: 'proj-1', repositoryUrl: PUBLIC_URL, branch: 'main', commitSha: 'abc1234' } }));
    expect(result.success).toBe(true);
    expect(deps.executor.execFile).toHaveBeenCalledTimes(4);
    expect(deps.executor.execFile.mock.calls[1][0]).toBe('git');
    expect(deps.executor.execFile.mock.calls[1][1]).toEqual(['fetch', '--depth', '1', 'origin', 'abc1234']);
    expect(deps.executor.execFile.mock.calls[1][2]).toEqual({ cwd: '/tmp/launchly-builds/deploy-1', timeout: 120, env: undefined });
    expect(deps.executor.execFile.mock.calls[2][0]).toBe('git');
    expect(deps.executor.execFile.mock.calls[2][1]).toEqual(['checkout', '--detach', 'FETCH_HEAD']);
    expect(deps.executor.execFile.mock.calls[2][2]).toEqual({ cwd: '/tmp/launchly-builds/deploy-1', timeout: 120, env: undefined });
    expect(deps.executor.execFile.mock.calls[3][0]).toBe('git');
    expect(deps.executor.execFile.mock.calls[3][1]).toEqual(['rev-parse', 'HEAD']);
  });

  it('commitSha present: HEAD mismatch fails closed with "实际 HEAD 与请求 commit 不一致" (KI-033)', async () => {
    // KI-033 修复后：fetch+checkout 成功后必须核对 HEAD 与请求一致；不一致直接拒绝。
    const deps = makeDeps();
    fsMock.existsSync.mockReturnValueOnce(false);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    deps.executor.execFile
      .mockResolvedValueOnce({ stdout: 'cloned', stderr: '', exitCode: 0 }) // clone
      .mockResolvedValueOnce({ stdout: 'fetched', stderr: '', exitCode: 0 }) // fetch
      .mockResolvedValueOnce({ stdout: 'switched', stderr: '', exitCode: 0 }) // checkout
      .mockResolvedValueOnce({ stdout: 'deadbeef', stderr: '', exitCode: 0 }); // rev-parse HEAD differs
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext({ payload: { projectId: 'proj-1', repositoryUrl: PUBLIC_URL, branch: 'main', commitSha: 'cafebabe' } }));
    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('实际 HEAD 与请求 commit 不一致');
    expect(result.errorMessage).toContain('cafebabe');
    expect(result.errorMessage).toContain('deadbeef');
  });

  it('commitSha present: fetch non-zero fails closed with "拉取失败" (KI-033)', async () => {
    const deps = makeDeps();
    fsMock.existsSync.mockReturnValueOnce(false);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    deps.executor.execFile
      .mockResolvedValueOnce({ stdout: 'cloned', stderr: '', exitCode: 0 }) // clone
      .mockResolvedValueOnce({ stdout: '', stderr: 'no such ref', exitCode: 1 }); // fetch fails
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext({ payload: { projectId: 'proj-1', repositoryUrl: PUBLIC_URL, branch: 'main', commitSha: 'deadbee' } }));
    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('指定 commit deadbee 拉取失败');
  });

  it('commitSha present: checkout non-zero fails closed with "检出失败" (KI-033)', async () => {
    const deps = makeDeps();
    fsMock.existsSync.mockReturnValueOnce(false);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    deps.executor.execFile
      .mockResolvedValueOnce({ stdout: 'cloned', stderr: '', exitCode: 0 }) // clone
      .mockResolvedValueOnce({ stdout: 'fetched', stderr: '', exitCode: 0 }) // fetch
      .mockResolvedValueOnce({ stdout: '', stderr: 'cannot switch', exitCode: 1 }); // checkout fails
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext({ payload: { projectId: 'proj-1', repositoryUrl: PUBLIC_URL, branch: 'main', commitSha: 'badcafe' } }));
    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('指定 commit badcafe 检出失败');
  });

  it('commitSha fetch non-zero stops before checkout and removes the incomplete context', async () => {
    const deps = makeDeps();
    fsMock.existsSync.mockReturnValueOnce(false);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    deps.executor.execFile
      .mockResolvedValueOnce({ stdout: 'cloned', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: 'no such ref', exitCode: 1 });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext({ payload: { projectId: 'proj-1', repositoryUrl: PUBLIC_URL, branch: 'main', commitSha: 'deadbee' } }));
    expect(result.success).toBe(false);
    expect(deps.executor.execFile).toHaveBeenCalledTimes(2);
    expect(fsMock.rmSync).toHaveBeenCalledWith('/tmp/launchly-builds/deploy-1', { recursive: true, force: true });
  });

  it('commitSha checkout non-zero fails and removes the incomplete context', async () => {
    const deps = makeDeps();
    fsMock.existsSync.mockReturnValueOnce(false);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    deps.executor.execFile
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: '', stderr: 'cannot switch', exitCode: 1 });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext({ payload: { projectId: 'proj-1', repositoryUrl: PUBLIC_URL, branch: 'main', commitSha: 'badcafe' } }));
    expect(result.success).toBe(false);
    expect(deps.executor.execFile).toHaveBeenCalledTimes(3);
    expect(fsMock.rmSync).toHaveBeenCalledWith('/tmp/launchly-builds/deploy-1', { recursive: true, force: true });
  });
});

// ─── C. GITHUB_APP ────────────────────────────────────────────────────────

describe('GitRunner.execute - GITHUB_APP source', () => {
  it('rejects when project does not exist', async () => {
    const deps = makeDeps();
    fsMock.existsSync.mockReturnValueOnce(false);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    deps.prisma.project.findUnique.mockResolvedValueOnce(null);
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext({ payload: { projectId: 'proj-1', repositoryUrl: 'https://github.com/acme/app.git', branch: 'main', sourceType: 'GITHUB_APP' } }));
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('GitHub App 源缺少 installation ID');
    expect(deps.githubApp.installationToken).not.toHaveBeenCalled();
    expect(deps.executor.execFile).not.toHaveBeenCalled();
  });

  it('rejects when project exists but githubInstallationId is missing', async () => {
    const deps = makeDeps();
    fsMock.existsSync.mockReturnValueOnce(false);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    deps.prisma.project.findUnique.mockResolvedValueOnce({ id: 'proj-1', githubInstallationId: null });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext({ payload: { projectId: 'proj-1', repositoryUrl: 'https://github.com/acme/app.git', branch: 'main', sourceType: 'GITHUB_APP' } }));
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('GitHub App 源缺少 installation ID');
  });

  it('rejects an installation that is not operator-bound to the project workspace', async () => {
    const deps = makeDeps();
    fsMock.existsSync.mockReturnValueOnce(false);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    deps.prisma.project.findUnique.mockResolvedValueOnce({ id: 'proj-1', workspaceId: 'ws-other', githubInstallationId: 'inst-1' });
    const runner = makeRunner(deps);

    const result = await runner.execute(makeContext({ payload: { projectId: 'proj-1', repositoryUrl: PUBLIC_URL, branch: 'main', sourceType: 'GITHUB_APP' } }));

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('未绑定到项目工作空间');
    expect(deps.githubApp.installationToken).not.toHaveBeenCalled();
    expect(deps.executor.execFile).not.toHaveBeenCalled();
  });

  it('rejects non-HTTPS repository URLs (http://)', async () => {
    const deps = makeDeps();
    fsMock.existsSync.mockReturnValueOnce(false);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    deps.prisma.project.findUnique.mockResolvedValueOnce({ id: 'proj-1', workspaceId: 'ws-1', githubInstallationId: 'inst-1' });
    deps.githubApp.installationToken.mockResolvedValueOnce('ghs_TESTSECRET123');
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext({ payload: { projectId: 'proj-1', repositoryUrl: 'http://github.com/acme/app.git', branch: 'main', sourceType: 'GITHUB_APP' } }));
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('仓库 URL / branch / commit 非法');
    expect(deps.executor.execFile).not.toHaveBeenCalled();
  });

  it('rejects HTTPS but non-github.com host', async () => {
    const deps = makeDeps();
    fsMock.existsSync.mockReturnValueOnce(false);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    deps.prisma.project.findUnique.mockResolvedValueOnce({ id: 'proj-1', workspaceId: 'ws-1', githubInstallationId: 'inst-1' });
    deps.githubApp.installationToken.mockResolvedValueOnce('ghs_TESTSECRET123');
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext({ payload: { projectId: 'proj-1', repositoryUrl: 'https://gitlab.com/acme/app.git', branch: 'main', sourceType: 'GITHUB_APP' } }));
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('GitHub App 源必须是 HTTPS github.com 仓库 URL');
  });

  it('rejects github.com.evil.com subdomain hijack attempt', async () => {
    const deps = makeDeps();
    fsMock.existsSync.mockReturnValueOnce(false);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    deps.prisma.project.findUnique.mockResolvedValueOnce({ id: 'proj-1', workspaceId: 'ws-1', githubInstallationId: 'inst-1' });
    deps.githubApp.installationToken.mockResolvedValueOnce('ghs_TESTSECRET123');
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext({ payload: { projectId: 'proj-1', repositoryUrl: 'https://github.com.evil.com/acme/app.git', branch: 'main', sourceType: 'GITHUB_APP' } }));
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('GitHub App 源必须是 HTTPS github.com 仓库 URL');
  });

  it('rejects completely invalid URLs (URL constructor throws, error propagates as failure)', async () => {
    const deps = makeDeps();
    fsMock.existsSync.mockReturnValueOnce(false);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    deps.prisma.project.findUnique.mockResolvedValueOnce({ id: 'proj-1', workspaceId: 'ws-1', githubInstallationId: 'inst-1' });
    deps.githubApp.installationToken.mockResolvedValueOnce('ghs_TESTSECRET123');
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext({ payload: { projectId: 'proj-1', repositoryUrl: 'not a url at all', branch: 'main', sourceType: 'GITHUB_APP' } }));
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('仓库 URL / branch / commit 非法');
  });

  it('on success: passes x-access-token URL to execFile but does not leak the token in stdout/stderr', async () => {
    const deps = makeDeps();
    fsMock.existsSync.mockReturnValueOnce(false);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    deps.prisma.project.findUnique.mockResolvedValueOnce({ id: 'proj-1', workspaceId: 'ws-1', githubInstallationId: 'inst-1' });
    deps.githubApp.installationToken.mockResolvedValueOnce('ghs_TESTSECRET123');
    deps.executor.execFile.mockResolvedValueOnce({
      stdout: 'remote https://x-access-token:ghs_TESTSECRET123@github.com/acme/app.git',
      stderr: 'token=ghs_TESTSECRET123',
      exitCode: 0,
    });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext({ payload: { projectId: 'proj-1', repositoryUrl: 'https://github.com/acme/app.git', branch: 'main', sourceType: 'GITHUB_APP' } }));
    expect(result.success).toBe(true);
    const urlPassed = deps.executor.execFile.mock.calls[0][1][6];
    expect(urlPassed).toBe('https://x-access-token:ghs_TESTSECRET123@github.com/acme/app.git');
    expect(result.stdout).not.toContain('ghs_TESTSECRET123');
    expect(result.stderr).not.toContain('ghs_TESTSECRET123');
    expect(JSON.stringify(result)).not.toContain('ghs_TESTSECRET123');
    expect(result.stdout).toContain('[REDACTED]');
    expect(result.stderr).toContain('[REDACTED]');
  });

  it('installationToken throws: failure propagates the original message', async () => {
    const deps = makeDeps();
    fsMock.existsSync.mockReturnValueOnce(false);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    deps.prisma.project.findUnique.mockResolvedValueOnce({ id: 'proj-1', workspaceId: 'ws-1', githubInstallationId: 'inst-1' });
    deps.githubApp.installationToken.mockRejectedValueOnce(new Error('Unable to obtain GitHub installation token'));
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext({ payload: { projectId: 'proj-1', repositoryUrl: 'https://github.com/acme/app.git', branch: 'main', sourceType: 'GITHUB_APP' } }));
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('Unable to obtain GitHub installation token');
    expect(deps.executor.execFile).not.toHaveBeenCalled();
  });
});

// ─── D. DEPLOY_KEY ─────────────────────────────────────────────────────────

describe('GitRunner.execute - DEPLOY_KEY source', () => {
  const HOST = 'github.com';
  const HOST_KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIABCDEFGHIJKLMNOPQRSTUVWXYZ trusted-nas';
  const PRIVATE_KEY_DECRYPTED = '-----BEGIN OPENSSH PRIVATE KEY-----\nMIIE...testkey...ABC\n-----END OPENSSH PRIVATE KEY-----';

  it('rejects when repositoryCredential row is missing', async () => {
    const deps = makeDeps();
    fsMock.existsSync.mockReturnValueOnce(false);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    deps.prisma.repositoryCredential.findUnique.mockResolvedValueOnce(null);
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext({ payload: { projectId: 'proj-1', repositoryUrl: 'git@github.com:acme/app.git', branch: 'main', sourceType: 'DEPLOY_KEY' } }));
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('Deploy Key 源缺少密钥或 pinned host key');
    expect(deps.secrets.decrypt).not.toHaveBeenCalled();
  });

  it('rejects when credentialType is not DEPLOY_KEY', async () => {
    const deps = makeDeps();
    fsMock.existsSync.mockReturnValueOnce(false);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    deps.prisma.repositoryCredential.findUnique.mockResolvedValueOnce({ id: 'cred-1', projectId: 'proj-1', credentialType: 'OAUTH', encryptedValue: 'v2:enc', hostKey: HOST_KEY });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext({ payload: { projectId: 'proj-1', repositoryUrl: 'git@github.com:acme/app.git', branch: 'main', sourceType: 'DEPLOY_KEY' } }));
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('Deploy Key 源缺少密钥或 pinned host key');
  });

  it('rejects when hostKey is missing', async () => {
    const deps = makeDeps();
    fsMock.existsSync.mockReturnValueOnce(false);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    deps.prisma.repositoryCredential.findUnique.mockResolvedValueOnce({ id: 'cred-1', projectId: 'proj-1', credentialType: 'DEPLOY_KEY', encryptedValue: 'v2:enc', hostKey: null });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext({ payload: { projectId: 'proj-1', repositoryUrl: 'git@github.com:acme/app.git', branch: 'main', sourceType: 'DEPLOY_KEY' } }));
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('Deploy Key 源缺少密钥或 pinned host key');
  });

  it('rejects HTTPS URLs (DEPLOY_KEY only supports SSH)', async () => {
    const deps = makeDeps();
    fsMock.existsSync.mockReturnValueOnce(false);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    deps.prisma.repositoryCredential.findUnique.mockResolvedValueOnce({ id: 'cred-1', projectId: 'proj-1', credentialType: 'DEPLOY_KEY', encryptedValue: 'v2:enc', hostKey: HOST_KEY });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext({ payload: { projectId: 'proj-1', repositoryUrl: 'https://github.com/acme/app.git', branch: 'main', sourceType: 'DEPLOY_KEY' } }));
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('Deploy Key 源必须是 SSH 仓库 URL');
    expect(deps.secrets.decrypt).not.toHaveBeenCalled();
  });

  it('rejects unparseable SSH URL', async () => {
    const deps = makeDeps();
    fsMock.existsSync.mockReturnValueOnce(false);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    deps.prisma.repositoryCredential.findUnique.mockResolvedValueOnce({ id: 'cred-1', projectId: 'proj-1', credentialType: 'DEPLOY_KEY', encryptedValue: 'v2:enc', hostKey: HOST_KEY });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext({ payload: { projectId: 'proj-1', repositoryUrl: '://broken', branch: 'main', sourceType: 'DEPLOY_KEY' } }));
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('仓库 URL / branch / commit 非法');
  });

  it('scp-style URL writes task-local private key and known_hosts with mode 0600', async () => {
    const deps = makeDeps();
    fsMock.existsSync.mockReturnValueOnce(false);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    deps.prisma.repositoryCredential.findUnique.mockResolvedValueOnce({ id: 'cred-1', projectId: 'proj-1', credentialType: 'DEPLOY_KEY', encryptedValue: 'v2:ciphertext', hostKey: HOST_KEY });
    deps.secrets.decrypt.mockImplementation((enc: string) => {
      if (enc !== 'v2:ciphertext') throw new Error('unknown ciphertext');
      return PRIVATE_KEY_DECRYPTED;
    });
    fsMock.writeFileSync.mockReturnValueOnce(undefined).mockReturnValueOnce(undefined);
    deps.executor.execFile.mockResolvedValueOnce({ stdout: 'cloned', stderr: '', exitCode: 0 });
    fsMock.unlinkSync.mockReturnValue(undefined);
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext({ payload: { projectId: 'proj-1', repositoryUrl: 'git@github.com:acme/app.git', branch: 'main', sourceType: 'DEPLOY_KEY' } }));
    expect(result.success).toBe(true);
    // decrypt receives the encryptedValue, not the plaintext
    expect(deps.secrets.decrypt).toHaveBeenCalledWith('v2:ciphertext');
    // writeFileSync called twice with mode 0600
    expect(fsMock.writeFileSync).toHaveBeenCalledTimes(2);
    expect(fsMock.writeFileSync.mock.calls[0]).toEqual(['/tmp/launchly-builds/.git-key-deploy-1', PRIVATE_KEY_DECRYPTED, { mode: 0o600 }]);
    expect(fsMock.writeFileSync.mock.calls[1]).toEqual(['/tmp/launchly-builds/.git-known-hosts-deploy-1', `${HOST} ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIABCDEFGHIJKLMNOPQRSTUVWXYZ\n`, { mode: 0o600 }]);
    // execFile called with git clone and the SSH env
    const call = deps.executor.execFile.mock.calls[0];
    expect(call[0]).toBe('git');
    expect(call[1]).toEqual(['clone', '--depth', '1', '--branch', 'main', '--', 'git@github.com:acme/app.git', '.']);
    const env = call[2].env;
    expect(env.GIT_SSH_COMMAND).toContain('IdentitiesOnly=yes');
    expect(env.GIT_SSH_COMMAND).toContain('BatchMode=yes');
    expect(env.GIT_SSH_COMMAND).toContain('PasswordAuthentication=no');
    expect(env.GIT_SSH_COMMAND).toContain('StrictHostKeyChecking=yes');
    expect(env.GIT_SSH_COMMAND).toContain('/tmp/launchly-builds/.git-known-hosts-deploy-1');
    expect(env.GIT_SSH_COMMAND).toContain('/tmp/launchly-builds/.git-key-deploy-1');
    expect(call[2].timeout).toBe(300);
  });

  it('ssh:// URL: same credential + known_hosts + env, host parsed from URL', async () => {
    const deps = makeDeps();
    fsMock.existsSync.mockReturnValueOnce(false);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    deps.prisma.repositoryCredential.findUnique.mockResolvedValueOnce({ id: 'cred-1', projectId: 'proj-1', credentialType: 'DEPLOY_KEY', encryptedValue: 'v2:ciphertext', hostKey: HOST_KEY });
    deps.secrets.decrypt.mockReturnValueOnce(PRIVATE_KEY_DECRYPTED);
    fsMock.writeFileSync.mockReturnValueOnce(undefined).mockReturnValueOnce(undefined);
    deps.executor.execFile.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 });
    fsMock.unlinkSync.mockReturnValue(undefined);
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext({ payload: { projectId: 'proj-1', repositoryUrl: 'ssh://git@github.com/acme/app.git', branch: 'main', sourceType: 'DEPLOY_KEY' } }));
    expect(result.success).toBe(true);
    expect(fsMock.writeFileSync.mock.calls[1][1]).toBe(`${HOST} ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIABCDEFGHIJKLMNOPQRSTUVWXYZ\n`);
  });

  it('secrets.decrypt throws: failure propagates and no execFile call', async () => {
    const deps = makeDeps();
    fsMock.existsSync.mockReturnValueOnce(false);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    deps.prisma.repositoryCredential.findUnique.mockResolvedValueOnce({ id: 'cred-1', projectId: 'proj-1', credentialType: 'DEPLOY_KEY', encryptedValue: 'v2:ciphertext', hostKey: HOST_KEY });
    deps.secrets.decrypt.mockImplementationOnce(() => { throw new Error('Encrypted value is malformed'); });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext({ payload: { projectId: 'proj-1', repositoryUrl: 'git@github.com:acme/app.git', branch: 'main', sourceType: 'DEPLOY_KEY' } }));
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('Encrypted value is malformed');
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
    expect(deps.executor.execFile).not.toHaveBeenCalled();
    expect(fsMock.unlinkSync.mock.calls).toEqual([
      ['/tmp/launchly-builds/.git-key-deploy-1'],
      ['/tmp/launchly-builds/.git-known-hosts-deploy-1'],
    ]);
  });

  it('first writeFileSync (private key) throws: failure, no known_hosts, no clone', async () => {
    const deps = makeDeps();
    fsMock.existsSync.mockReturnValueOnce(false);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    deps.prisma.repositoryCredential.findUnique.mockResolvedValueOnce({ id: 'cred-1', projectId: 'proj-1', credentialType: 'DEPLOY_KEY', encryptedValue: 'v2:ciphertext', hostKey: HOST_KEY });
    deps.secrets.decrypt.mockReturnValueOnce(PRIVATE_KEY_DECRYPTED);
    fsMock.writeFileSync.mockImplementationOnce(() => { throw new Error('EACCES'); });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext({ payload: { projectId: 'proj-1', repositoryUrl: 'git@github.com:acme/app.git', branch: 'main', sourceType: 'DEPLOY_KEY' } }));
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('EACCES');
    expect(fsMock.writeFileSync).toHaveBeenCalledTimes(1);
    expect(deps.executor.execFile).not.toHaveBeenCalled();
    expect(fsMock.unlinkSync.mock.calls).toEqual([
      ['/tmp/launchly-builds/.git-key-deploy-1'],
      ['/tmp/launchly-builds/.git-known-hosts-deploy-1'],
    ]);
  });

  it('second writeFileSync failure removes the private key and incomplete source context', async () => {
    const deps = makeDeps();
    fsMock.existsSync.mockReturnValueOnce(false);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    deps.prisma.repositoryCredential.findUnique.mockResolvedValueOnce({ id: 'cred-1', projectId: 'proj-1', credentialType: 'DEPLOY_KEY', encryptedValue: 'v2:ciphertext', hostKey: HOST_KEY });
    deps.secrets.decrypt.mockReturnValueOnce(PRIVATE_KEY_DECRYPTED);
    fsMock.writeFileSync.mockReturnValueOnce(undefined).mockImplementationOnce(() => { throw new Error('ENOSPC'); });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext({ payload: { projectId: 'proj-1', repositoryUrl: 'git@github.com:acme/app.git', branch: 'main', sourceType: 'DEPLOY_KEY' } }));
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('ENOSPC');
    expect(fsMock.writeFileSync).toHaveBeenCalledTimes(2);
    expect(deps.executor.execFile).not.toHaveBeenCalled();
    expect(fsMock.unlinkSync.mock.calls).toEqual([
      ['/tmp/launchly-builds/.git-key-deploy-1'],
      ['/tmp/launchly-builds/.git-known-hosts-deploy-1'],
    ]);
    expect(fsMock.rmSync).toHaveBeenCalledWith('/tmp/launchly-builds/deploy-1', { recursive: true, force: true });
  });

  it('executor failure removes deploy-key files and the incomplete source context', async () => {
    const deps = makeDeps();
    fsMock.existsSync.mockReturnValueOnce(false);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    deps.prisma.repositoryCredential.findUnique.mockResolvedValueOnce({ id: 'cred-1', projectId: 'proj-1', credentialType: 'DEPLOY_KEY', encryptedValue: 'v2:ciphertext', hostKey: HOST_KEY });
    deps.secrets.decrypt.mockReturnValueOnce(PRIVATE_KEY_DECRYPTED);
    fsMock.writeFileSync.mockReturnValueOnce(undefined).mockReturnValueOnce(undefined);
    deps.executor.execFile.mockRejectedValueOnce(new Error('spawn ENOENT git'));
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext({ payload: { projectId: 'proj-1', repositoryUrl: 'git@github.com:acme/app.git', branch: 'main', sourceType: 'DEPLOY_KEY' } }));
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('spawn ENOENT git');
    expect(fsMock.unlinkSync.mock.calls).toEqual([
      ['/tmp/launchly-builds/.git-key-deploy-1'],
      ['/tmp/launchly-builds/.git-known-hosts-deploy-1'],
    ]);
    expect(fsMock.writeFileSync).toHaveBeenCalledTimes(2); // private key + known_hosts were written
    expect(fsMock.rmSync).toHaveBeenCalledWith('/tmp/launchly-builds/deploy-1', { recursive: true, force: true });
  });

  it('unlink failure during cleanup does not change the success result', async () => {
    const deps = makeDeps();
    fsMock.existsSync.mockReturnValueOnce(false);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    deps.prisma.repositoryCredential.findUnique.mockResolvedValueOnce({ id: 'cred-1', projectId: 'proj-1', credentialType: 'DEPLOY_KEY', encryptedValue: 'v2:ciphertext', hostKey: HOST_KEY });
    deps.secrets.decrypt.mockReturnValueOnce(PRIVATE_KEY_DECRYPTED);
    fsMock.writeFileSync.mockReturnValueOnce(undefined).mockReturnValueOnce(undefined);
    deps.executor.execFile.mockResolvedValueOnce({ stdout: 'cloned', stderr: '', exitCode: 0 });
    fsMock.unlinkSync.mockImplementationOnce(() => { throw new Error('EACCES unlink'); });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext({ payload: { projectId: 'proj-1', repositoryUrl: 'git@github.com:acme/app.git', branch: 'main', sourceType: 'DEPLOY_KEY' } }));
    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(fsMock.unlinkSync).toHaveBeenCalledTimes(2);
  });

  it('successful DEPLOY_KEY result: never leaks private key, host key, or token in result or serialized form (KI-034)', async () => {
    // 凭据保存在构建上下文外，避免让 clone 目标非空或被 BuildKit 打包。
    const deps = makeDeps();
    fsMock.existsSync.mockReturnValueOnce(false);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    deps.prisma.repositoryCredential.findUnique.mockResolvedValueOnce({ id: 'cred-1', projectId: 'proj-1', credentialType: 'DEPLOY_KEY', encryptedValue: 'v2:ciphertext', hostKey: HOST_KEY });
    deps.secrets.decrypt.mockReturnValueOnce(PRIVATE_KEY_DECRYPTED);
    fsMock.writeFileSync.mockReturnValueOnce(undefined).mockReturnValueOnce(undefined);
    deps.executor.execFile.mockResolvedValueOnce({
      stdout: PRIVATE_KEY_DECRYPTED,
      stderr: 'token=ghp_abcdefghijklmnopqrstuvwxyz',
      exitCode: 0,
    });
    fsMock.unlinkSync.mockReturnValue(undefined);
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext({ payload: { projectId: 'proj-1', repositoryUrl: 'git@github.com:acme/app.git', branch: 'main', sourceType: 'DEPLOY_KEY' } }));
    expect(result.success).toBe(true);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(PRIVATE_KEY_DECRYPTED);
    expect(serialized).not.toContain('v2:ciphertext');
    expect(serialized).not.toContain(HOST_KEY.trim());
    expect(serialized).not.toContain('ssh-ed25519');
    expect(serialized).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz');
    expect(result.stdout).toContain('[REDACTED]');
    expect(result.stderr).toContain('[REDACTED]');
    // 任务专属凭据文件在构建上下文之外。
    expect(fsMock.unlinkSync.mock.calls).toEqual([
      ['/tmp/launchly-builds/.git-key-deploy-1'],
      ['/tmp/launchly-builds/.git-known-hosts-deploy-1'],
    ]);
  });
});

// ─── E. Path boundary (refId-based path escape) ────────────────────────────

describe('GitRunner.execute - refId path boundary', () => {
  it('refId "../escape-1" is rejected by assertSafeRefId before any fs/Prisma/executor call (KI-032)', async () => {
    // KI-032 修复后：caller 控制的 refId 必须先通过 assertSafeRefId；'../escape-1' 包含非法字符 '/'
    // 会被拒绝并返回失败结果。早期 path.join 直接归一化的"逃逸 BUILD_ROOT"候选缺陷已消除。
    const deps = makeDeps();
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext({ refId: '../escape-1' }));
    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('refId 必须是字母/数字/下划线/连字符组成的 1-128 字符 ID');
    expect(fsMock.mkdirSync).not.toHaveBeenCalled();
    expect(fsMock.existsSync).not.toHaveBeenCalled();
    expect(deps.executor.execFile).not.toHaveBeenCalled();
    expect(deps.prisma.project.findUnique).not.toHaveBeenCalled();
  });

  it('rejects unsafe DEPLOY_KEY refId before resolving credential paths', async () => {
    const deps = makeDeps();
    fsMock.existsSync.mockReturnValueOnce(false);
    fsMock.mkdirSync.mockReturnValueOnce(undefined);
    deps.prisma.repositoryCredential.findUnique.mockResolvedValueOnce({ id: 'cred-1', projectId: 'proj-1', credentialType: 'DEPLOY_KEY', encryptedValue: 'v2:ciphertext', hostKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIABCDEFGHIJKLMNOPQRSTUVWXYZ trusted-nas' });
    deps.secrets.decrypt.mockReturnValueOnce('FAKEKEY');
    fsMock.writeFileSync.mockReturnValueOnce(undefined).mockReturnValueOnce(undefined);
    deps.executor.execFile.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 });
    fsMock.unlinkSync.mockReturnValue(undefined);
    const runner = makeRunner(deps);
    await runner.execute(makeContext({
      refId: 'subdir/../../etc',
      payload: { projectId: 'proj-1', repositoryUrl: 'git@github.com:acme/app.git', branch: 'main', sourceType: 'DEPLOY_KEY' },
    }));
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
    expect(deps.executor.execFile).not.toHaveBeenCalled();
  });
});
