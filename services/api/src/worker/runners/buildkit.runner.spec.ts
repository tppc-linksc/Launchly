/* eslint-disable @typescript-eslint/no-explicit-any */
import * as fs from 'fs';
import { BuildkitRunner } from './buildkit.runner';
import { RunnerContext } from './runner.factory';

// ─── fs mock (per-method, default safe values; test installs stricter impls) ─

vi.mock('fs', async () => {
  const real = await vi.importActual<typeof import('fs')>('fs');
  const safe = () => vi.fn();
  const overrides: any = {
    existsSync: safe(),
    writeFileSync: safe(),
    readFileSync: safe(),
    rmSync: safe(),
    mkdirSync: safe(),
  };
  return { ...real, ...overrides, __launchlyFsOverrides: overrides };
});

const fsMock = (fs as any).__launchlyFsOverrides as {
  existsSync: vi.Mock;
  writeFileSync: vi.Mock;
  readFileSync: vi.Mock;
  rmSync: vi.Mock;
  mkdirSync: vi.Mock;
};

const ORIGINAL_REGISTRY = process.env.LAUNCHLY_DEFAULT_REGISTRY_REPOSITORY;
const ORIGINAL_BUILDKIT_ADDR = process.env.LAUNCHLY_BUILDKIT_ADDR;
const ORIGINAL_REGISTRY_AUTH = process.env.LAUNCHLY_REGISTRY_AUTH_JSON;

const unexpectedSync =
  (name: string) =>
  (...args: unknown[]) => {
    throw new Error(`Unexpected unconfigured fs.${name} call: ${JSON.stringify(args)}`);
  };

beforeEach(() => {
  delete process.env.LAUNCHLY_DEFAULT_REGISTRY_REPOSITORY;
  delete process.env.LAUNCHLY_BUILDKIT_ADDR;
  delete process.env.LAUNCHLY_REGISTRY_AUTH_JSON;
  for (const fn of Object.values(fsMock)) {
    fn.mockReset();
  }
  fsMock.existsSync.mockImplementation(unexpectedSync('existsSync'));
  fsMock.writeFileSync.mockImplementation(unexpectedSync('writeFileSync'));
  fsMock.readFileSync.mockImplementation(unexpectedSync('readFileSync'));
  fsMock.rmSync.mockImplementation(unexpectedSync('rmSync'));
  fsMock.mkdirSync.mockImplementation(unexpectedSync('mkdirSync'));
});

afterEach(() => {
  if (ORIGINAL_REGISTRY === undefined) delete process.env.LAUNCHLY_DEFAULT_REGISTRY_REPOSITORY;
  else process.env.LAUNCHLY_DEFAULT_REGISTRY_REPOSITORY = ORIGINAL_REGISTRY;
  if (ORIGINAL_BUILDKIT_ADDR === undefined) delete process.env.LAUNCHLY_BUILDKIT_ADDR;
  else process.env.LAUNCHLY_BUILDKIT_ADDR = ORIGINAL_BUILDKIT_ADDR;
  if (ORIGINAL_REGISTRY_AUTH === undefined) delete process.env.LAUNCHLY_REGISTRY_AUTH_JSON;
  else process.env.LAUNCHLY_REGISTRY_AUTH_JSON = ORIGINAL_REGISTRY_AUTH;
});

// ─── Fixtures & helpers ────────────────────────────────────────────────────

const FIXED_DIGEST = 'a'.repeat(64);

function makeContext(over: Partial<RunnerContext> = {}): RunnerContext {
  return {
    taskType: 'PROJECT_BUILD',
    refId: 'deploy-1',
    payload: { containerPort: 3000 },
    stageLogCallback: vi.fn(async () => undefined),
    ...over,
  };
}

function makePrismaDouble() {
  const unexpectedAsync = (name: string) =>
    vi.fn(async (...args: unknown[]) => {
      throw new Error(`Unexpected unconfigured ${name} call: ${JSON.stringify(args)}`);
    });
  const prisma: any = {
    deployment: {
      findUnique: unexpectedAsync('prisma.deployment.findUnique'),
      update: unexpectedAsync('prisma.deployment.update'),
    },
    artifact: { upsert: unexpectedAsync('prisma.artifact.upsert') },
  };
  return prisma;
}

function makeExecutor(): { execFile: vi.Mock } {
  return {
    execFile: vi.fn(async (...args: unknown[]): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
      throw new Error(`Unexpected unconfigured executor.execFile call: ${JSON.stringify(args)}`);
    }),
  };
}

function makeRunner(prisma: any, executor: any) {
  return new BuildkitRunner(prisma, executor);
}

function metadataJson(digest: any) {
  return JSON.stringify({ 'containerimage.digest': digest });
}

// ─── A. Pre-validation ────────────────────────────────────────────────────

describe('BuildkitRunner.execute - pre-validation', () => {
  it('returns failure when deployment does not exist and never touches executor/artifact/deployment.update', async () => {
    const prisma = makePrismaDouble();
    prisma.deployment.findUnique.mockResolvedValueOnce(null);
    const executor = makeExecutor();
    const runner = makeRunner(prisma, executor);
    const result = await runner.execute(makeContext());
    expect(result).toEqual({
      success: false,
      stdout: '',
      stderr: 'Deployment not found',
      exitCode: -1,
      errorMessage: 'Deployment not found',
    });
    expect(executor.execFile).not.toHaveBeenCalled();
    expect(prisma.artifact.upsert).not.toHaveBeenCalled();
    expect(prisma.deployment.update).not.toHaveBeenCalled();
  });

  it('propagates deployment.findUnique errors (current behavior: no try/catch around findUnique)', async () => {
    const prisma = makePrismaDouble();
    (prisma.deployment.findUnique as vi.Mock).mockImplementationOnce(() => Promise.reject(new Error('db down')));
    const executor = makeExecutor();
    const runner = makeRunner(prisma, executor);
    await expect(runner.execute(makeContext())).rejects.toThrow('db down');
    expect(executor.execFile).not.toHaveBeenCalled();
    expect(prisma.artifact.upsert).not.toHaveBeenCalled();
    expect(prisma.deployment.update).not.toHaveBeenCalled();
  });

  it('project registryRepository wins over LAUNCHLY_DEFAULT_REGISTRY_REPOSITORY env (current priority)', async () => {
    process.env.LAUNCHLY_DEFAULT_REGISTRY_REPOSITORY = 'env.example.com/team/from-env';
    process.env.LAUNCHLY_BUILDKIT_ADDR = 'unix:///run/buildkit/buildkitd.sock';
    const prisma = makePrismaDouble();
    prisma.deployment.findUnique.mockResolvedValueOnce({
      id: 'deploy-1',
      projectId: 'proj-1',
      commitSha: 'abc1234',
      project: { registryRepository: 'project.example.com/team/from-project' },
    });
    fsMock.existsSync.mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValueOnce(true);
    fsMock.readFileSync.mockReturnValueOnce(metadataJson(`sha256:${FIXED_DIGEST}`));
    const executor = makeExecutor();
    executor.execFile.mockResolvedValueOnce({ stdout: 'built', stderr: '', exitCode: 0 });
    prisma.artifact.upsert.mockResolvedValueOnce({ id: 'artifact-1' });
    prisma.deployment.update.mockResolvedValueOnce({ id: 'deploy-1' });
    const runner = makeRunner(prisma, executor);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(true);
    const argv = executor.execFile.mock.calls[0][1] as string[];
    expect(argv).toContain('type=image,name=project.example.com/team/from-project:abc1234-deploy-1,push=true');
    expect(argv.join(' ')).not.toContain('env.example.com');
  });

  it('falls back to LAUNCHLY_DEFAULT_REGISTRY_REPOSITORY env when project has no registryRepository', async () => {
    process.env.LAUNCHLY_DEFAULT_REGISTRY_REPOSITORY = 'env.example.com/team/from-env';
    process.env.LAUNCHLY_BUILDKIT_ADDR = 'unix:///run/buildkit/buildkitd.sock';
    const prisma = makePrismaDouble();
    prisma.deployment.findUnique.mockResolvedValueOnce({
      id: 'deploy-1',
      projectId: 'proj-1',
      commitSha: 'abc1234',
      project: { registryRepository: null },
    });
    fsMock.existsSync.mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValueOnce(true);
    fsMock.readFileSync.mockReturnValueOnce(metadataJson(`sha256:${FIXED_DIGEST}`));
    const executor = makeExecutor();
    executor.execFile.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 });
    prisma.artifact.upsert.mockResolvedValueOnce({ id: 'a' });
    prisma.deployment.update.mockResolvedValueOnce({ id: 'd' });
    const runner = makeRunner(prisma, executor);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(true);
    const argv = executor.execFile.mock.calls[0][1] as string[];
    expect(argv).toContain('type=image,name=env.example.com/team/from-env:abc1234-deploy-1,push=true');
  });

  it('rejects when both repository and address are missing (current behavior)', async () => {
    const prisma = makePrismaDouble();
    prisma.deployment.findUnique.mockResolvedValueOnce({
      id: 'deploy-1',
      projectId: 'proj-1',
      commitSha: 'abc1234',
      project: { registryRepository: null },
    });
    const executor = makeExecutor();
    const runner = makeRunner(prisma, executor);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('BuildKit address and project registry repository are required');
    expect(executor.execFile).not.toHaveBeenCalled();
  });

  it('rejects when only address is set (current behavior)', async () => {
    process.env.LAUNCHLY_BUILDKIT_ADDR = 'tcp://buildkit.example.com:1234';
    const prisma = makePrismaDouble();
    prisma.deployment.findUnique.mockResolvedValueOnce({
      id: 'deploy-1',
      projectId: 'proj-1',
      commitSha: 'abc1234',
      project: { registryRepository: null },
    });
    const executor = makeExecutor();
    const runner = makeRunner(prisma, executor);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('BuildKit address and project registry repository are required');
  });

  it('rejects when only repository is set (current behavior)', async () => {
    const prisma = makePrismaDouble();
    prisma.deployment.findUnique.mockResolvedValueOnce({
      id: 'deploy-1',
      projectId: 'proj-1',
      commitSha: 'abc1234',
      project: { registryRepository: 'project.example.com/team/app' },
    });
    const executor = makeExecutor();
    const runner = makeRunner(prisma, executor);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('BuildKit address and project registry repository are required');
  });

  it('rejects repository with whitespace, newline, or shell metachars (current behavior)', async () => {
    process.env.LAUNCHLY_BUILDKIT_ADDR = 'unix:///run/buildkit/buildkitd.sock';
    for (const bad of ['bad name', 'with\nnewline', 'evil;rm -rf $HOME', 'with`backtick`']) {
      const prisma = makePrismaDouble();
      prisma.deployment.findUnique.mockResolvedValueOnce({
        id: 'deploy-1',
        projectId: 'proj-1',
        commitSha: 'abc1234',
        project: { registryRepository: bad },
      });
      const executor = makeExecutor();
      const runner = makeRunner(prisma, executor);
      const result = await runner.execute(makeContext());
      expect(result.success).toBe(false);
      expect(result.errorMessage).toBe('Registry repository contains unsupported characters');
      expect(executor.execFile).not.toHaveBeenCalled();
    }
  });

  it('rejects when workDir does not exist (no executor call)', async () => {
    process.env.LAUNCHLY_BUILDKIT_ADDR = 'tcp://buildkit.example.com:1234';
    const prisma = makePrismaDouble();
    prisma.deployment.findUnique.mockResolvedValueOnce({
      id: 'deploy-1',
      projectId: 'proj-1',
      commitSha: 'abc1234',
      project: { registryRepository: 'project.example.com/team/app' },
    });
    fsMock.existsSync.mockReturnValueOnce(false); // workDir missing
    const executor = makeExecutor();
    const runner = makeRunner(prisma, executor);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('Build context is missing');
    expect(executor.execFile).not.toHaveBeenCalled();
    expect(prisma.artifact.upsert).not.toHaveBeenCalled();
    expect(prisma.deployment.update).not.toHaveBeenCalled();
  });
});

// ─── B. Dockerfile selection & build context ──────────────────────────────

describe('BuildkitRunner.execute - Dockerfile selection', () => {
  function setupSuccessEnv(
    prisma: any,
    executor: any,
    opts: { dockerfileExists: boolean; launchlyExists: boolean; digest: string } = {
      dockerfileExists: true,
      launchlyExists: false,
      digest: `sha256:${FIXED_DIGEST}`,
    },
  ) {
    process.env.LAUNCHLY_BUILDKIT_ADDR = 'tcp://buildkit.example.com:1234';
    prisma.deployment.findUnique.mockResolvedValueOnce({
      id: 'deploy-1',
      projectId: 'proj-1',
      commitSha: 'abc1234',
      project: { registryRepository: 'project.example.com/team/app' },
    });
    // workDir, Dockerfile choice, then the selected Dockerfile is checked again.
    fsMock.existsSync
      .mockReturnValueOnce(true) // workDir
      .mockReturnValueOnce(opts.dockerfileExists) // Dockerfile
      .mockReturnValueOnce(opts.dockerfileExists || opts.launchlyExists); // selected file
    if (!opts.dockerfileExists && !opts.launchlyExists) {
      // write implicit
      fsMock.writeFileSync.mockReturnValueOnce(undefined);
    }
    fsMock.readFileSync.mockReturnValueOnce(metadataJson(opts.digest));
    executor.execFile.mockResolvedValueOnce({ stdout: 'built', stderr: '', exitCode: 0 });
    prisma.artifact.upsert.mockResolvedValueOnce({ id: 'a' });
    prisma.deployment.update.mockResolvedValueOnce({ id: 'd' });
  }

  it('uses Dockerfile when it exists', async () => {
    const prisma = makePrismaDouble();
    const executor = makeExecutor();
    setupSuccessEnv(prisma, executor, {
      dockerfileExists: true,
      launchlyExists: false,
      digest: `sha256:${FIXED_DIGEST}`,
    });
    const runner = makeRunner(prisma, executor);
    await runner.execute(makeContext());
    const argv = executor.execFile.mock.calls[0][1];
    const filenameIdx = argv.indexOf('--opt');
    expect(argv[filenameIdx + 1]).toBe('filename=Dockerfile');
  });

  it('uses Dockerfile.launchly when only it exists', async () => {
    const prisma = makePrismaDouble();
    const executor = makeExecutor();
    setupSuccessEnv(prisma, executor, {
      dockerfileExists: false,
      launchlyExists: true,
      digest: `sha256:${FIXED_DIGEST}`,
    });
    const runner = makeRunner(prisma, executor);
    await runner.execute(makeContext());
    const argv = executor.execFile.mock.calls[0][1];
    const filenameIdx = argv.indexOf('--opt');
    expect(argv[filenameIdx + 1]).toBe('filename=Dockerfile.launchly');
  });

  it('writes an implicit Dockerfile (mode 0600) and uses it when neither file exists', async () => {
    const prisma = makePrismaDouble();
    const executor = makeExecutor();
    setupSuccessEnv(prisma, executor, {
      dockerfileExists: false,
      launchlyExists: false,
      digest: `sha256:${FIXED_DIGEST}`,
    });
    const runner = makeRunner(prisma, executor);
    await runner.execute(
      makeContext({
        payload: { containerPort: 4000, installCommand: 'pnpm i', buildCommand: 'pnpm b', startCommand: 'pnpm start' },
      }),
    );
    expect(fsMock.writeFileSync).toHaveBeenCalledTimes(1);
    expect(fsMock.writeFileSync.mock.calls[0][0]).toBe('/tmp/launchly-builds/deploy-1/Dockerfile.launchly');
    expect(fsMock.writeFileSync.mock.calls[0][2]).toEqual({ mode: 0o600 });
    const dockerfile = fsMock.writeFileSync.mock.calls[0][1] as string;
    expect(dockerfile).toContain('FROM node:22-bookworm-slim');
    expect(dockerfile).toContain('RUN pnpm i');
    expect(dockerfile).toContain('RUN pnpm b');
    expect(dockerfile).toContain('CMD pnpm start');
    expect(dockerfile).toContain('EXPOSE 4000');
    const argv = executor.execFile.mock.calls[0][1];
    const filenameIdx = argv.indexOf('--opt');
    expect(argv[filenameIdx + 1]).toBe('filename=Dockerfile.launchly');
  });

  it('implicit Dockerfile defaults install/build/start to npm ci / npm run build / npm start when payload omits them', async () => {
    const prisma = makePrismaDouble();
    const executor = makeExecutor();
    setupSuccessEnv(prisma, executor, {
      dockerfileExists: false,
      launchlyExists: false,
      digest: `sha256:${FIXED_DIGEST}`,
    });
    const runner = makeRunner(prisma, executor);
    await runner.execute(makeContext({ payload: {} }));
    const dockerfile = fsMock.writeFileSync.mock.calls[0][1] as string;
    expect(dockerfile).toContain('RUN npm ci');
    expect(dockerfile).toContain('RUN npm run build');
    expect(dockerfile).toContain('CMD npm start');
  });

  it('implicit Dockerfile port falls back to 3000 when neither containerPort nor port is provided (current behavior)', async () => {
    const prisma = makePrismaDouble();
    const executor = makeExecutor();
    setupSuccessEnv(prisma, executor, {
      dockerfileExists: false,
      launchlyExists: false,
      digest: `sha256:${FIXED_DIGEST}`,
    });
    const runner = makeRunner(prisma, executor);
    await runner.execute(makeContext({ payload: {} }));
    const dockerfile = fsMock.writeFileSync.mock.calls[0][1] as string;
    expect(dockerfile).toContain('EXPOSE 3000');
  });

  it('implicit Dockerfile uses payload.port when containerPort is missing', async () => {
    const prisma = makePrismaDouble();
    const executor = makeExecutor();
    setupSuccessEnv(prisma, executor, {
      dockerfileExists: false,
      launchlyExists: false,
      digest: `sha256:${FIXED_DIGEST}`,
    });
    const runner = makeRunner(prisma, executor);
    await runner.execute(makeContext({ payload: { port: 8080 } }));
    const dockerfile = fsMock.writeFileSync.mock.calls[0][1] as string;
    expect(dockerfile).toContain('EXPOSE 8080');
  });

  it('implicit Dockerfile port falls back to 3000 for a non-numeric value', async () => {
    const prisma = makePrismaDouble();
    const executor = makeExecutor();
    setupSuccessEnv(prisma, executor, {
      dockerfileExists: false,
      launchlyExists: false,
      digest: `sha256:${FIXED_DIGEST}`,
    });
    const runner = makeRunner(prisma, executor);
    await runner.execute(makeContext({ payload: { containerPort: 'not-a-number' } }));
    const dockerfile = fsMock.writeFileSync.mock.calls[0][1] as string;
    expect(dockerfile).toContain('EXPOSE 3000');
  });

  it('implicit Dockerfile port falls back to 3000 for a negative value', async () => {
    const prisma = makePrismaDouble();
    const executor = makeExecutor();
    setupSuccessEnv(prisma, executor, {
      dockerfileExists: false,
      launchlyExists: false,
      digest: `sha256:${FIXED_DIGEST}`,
    });
    const runner = makeRunner(prisma, executor);
    await runner.execute(makeContext({ payload: { containerPort: -1 } }));
    const dockerfile = fsMock.writeFileSync.mock.calls[0][1] as string;
    expect(dockerfile).toContain('EXPOSE 3000');
  });

  it('implicit Dockerfile port falls back to 3000 above 65535', async () => {
    const prisma = makePrismaDouble();
    const executor = makeExecutor();
    setupSuccessEnv(prisma, executor, {
      dockerfileExists: false,
      launchlyExists: false,
      digest: `sha256:${FIXED_DIGEST}`,
    });
    const runner = makeRunner(prisma, executor);

    await runner.execute(makeContext({ payload: { containerPort: 65536 } }));

    expect(fsMock.writeFileSync.mock.calls[0][1]).toContain('EXPOSE 3000');
  });

  it('places custom shell fragments directly into RUN and CMD instructions (current behavior)', async () => {
    const prisma = makePrismaDouble();
    const executor = makeExecutor();
    setupSuccessEnv(prisma, executor, {
      dockerfileExists: false,
      launchlyExists: false,
      digest: `sha256:${FIXED_DIGEST}`,
    });
    const runner = makeRunner(prisma, executor);

    await runner.execute(
      makeContext({
        payload: {
          installCommand: 'npm ci && echo install-marker',
          buildCommand: 'npm run build; echo build-marker',
          startCommand: 'sh -c "echo start-marker"',
        },
      }),
    );

    const dockerfile = fsMock.writeFileSync.mock.calls[0][1] as string;
    expect(dockerfile).toContain('RUN npm ci && echo install-marker');
    expect(dockerfile).toContain('RUN npm run build; echo build-marker');
    expect(dockerfile).toContain('CMD sh -c "echo start-marker"');
  });
});

// ─── C. commitSha / safeTag ───────────────────────────────────────────────

describe('BuildkitRunner.execute - commitSha safeTag', () => {
  function setupWithCommit(prisma: any, executor: any, commitSha: any) {
    process.env.LAUNCHLY_BUILDKIT_ADDR = 'tcp://buildkit.example.com:1234';
    prisma.deployment.findUnique.mockResolvedValueOnce({
      id: 'deploy-1',
      projectId: 'proj-1',
      commitSha,
      project: { registryRepository: 'project.example.com/team/app' },
    });
    fsMock.existsSync.mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValueOnce(true);
    fsMock.readFileSync.mockReturnValueOnce(metadataJson(`sha256:${FIXED_DIGEST}`));
    executor.execFile.mockResolvedValueOnce({ stdout: 'built', stderr: '', exitCode: 0 });
    prisma.artifact.upsert.mockResolvedValueOnce({ id: 'a' });
    prisma.deployment.update.mockResolvedValueOnce({ id: 'd' });
  }

  it('7-char hex commitSha is lowercased and forms the tag', async () => {
    const prisma = makePrismaDouble();
    const executor = makeExecutor();
    setupWithCommit(prisma, executor, 'ABC1234');
    const runner = makeRunner(prisma, executor);
    await runner.execute(makeContext());
    const argv = executor.execFile.mock.calls[0][1];
    expect(argv).toContain('type=image,name=project.example.com/team/app:abc1234-deploy-1,push=true');
  });

  it('12-char hex commitSha is lowercased and forms the tag', async () => {
    const prisma = makePrismaDouble();
    const executor = makeExecutor();
    setupWithCommit(prisma, executor, 'AbCdEf012345');
    const runner = makeRunner(prisma, executor);
    await runner.execute(makeContext());
    const argv = executor.execFile.mock.calls[0][1];
    expect(argv).toContain('type=image,name=project.example.com/team/app:abcdef012345-deploy-1,push=true');
  });

  it('64-char hex commitSha is sliced to 12 chars and lowercased', async () => {
    const prisma = makePrismaDouble();
    const executor = makeExecutor();
    setupWithCommit(prisma, executor, 'A'.repeat(64));
    const runner = makeRunner(prisma, executor);
    await runner.execute(makeContext());
    const argv = executor.execFile.mock.calls[0][1];
    expect(argv).toContain('type=image,name=project.example.com/team/app:aaaaaaaaaaaa-deploy-1,push=true');
  });

  it('non-hex commitSha yields the literal "unknown" tag', async () => {
    const prisma = makePrismaDouble();
    const executor = makeExecutor();
    setupWithCommit(prisma, executor, 'NOT-HEX!');
    const runner = makeRunner(prisma, executor);
    await runner.execute(makeContext());
    const argv = executor.execFile.mock.calls[0][1];
    expect(argv).toContain('type=image,name=project.example.com/team/app:unknown-deploy-1,push=true');
  });

  it('6-char hex commitSha (too short) yields "unknown" tag', async () => {
    const prisma = makePrismaDouble();
    const executor = makeExecutor();
    setupWithCommit(prisma, executor, 'abcdef');
    const runner = makeRunner(prisma, executor);
    await runner.execute(makeContext());
    const argv = executor.execFile.mock.calls[0][1];
    expect(argv).toContain('type=image,name=project.example.com/team/app:unknown-deploy-1,push=true');
  });

  it('null commitSha yields "unknown" tag', async () => {
    const prisma = makePrismaDouble();
    const executor = makeExecutor();
    setupWithCommit(prisma, executor, null);
    const runner = makeRunner(prisma, executor);
    await runner.execute(makeContext());
    const argv = executor.execFile.mock.calls[0][1];
    expect(argv).toContain('type=image,name=project.example.com/team/app:unknown-deploy-1,push=true');
  });
});

// ─── D. buildctl call and metadata ────────────────────────────────────────

describe('BuildkitRunner.execute - buildctl call, callback, metadata', () => {
  function setupFullSuccess(prisma: any, executor: any) {
    process.env.LAUNCHLY_BUILDKIT_ADDR = 'tcp://buildkit.example.com:1234';
    prisma.deployment.findUnique.mockResolvedValueOnce({
      id: 'deploy-1',
      projectId: 'proj-1',
      commitSha: 'abc1234',
      project: { registryRepository: 'project.example.com/team/app' },
    });
    fsMock.existsSync.mockReturnValue(true); // workDir, Dockerfile, anything
    fsMock.readFileSync.mockReturnValueOnce(metadataJson(`sha256:${FIXED_DIGEST}`));
    executor.execFile.mockResolvedValueOnce({ stdout: 'built-ok', stderr: '', exitCode: 0 });
    prisma.artifact.upsert.mockResolvedValueOnce({ id: 'a' });
    prisma.deployment.update.mockResolvedValueOnce({ id: 'd' });
  }

  it('passes exact buildctl argv, metadata path, and timeout 1800', async () => {
    const prisma = makePrismaDouble();
    const executor = makeExecutor();
    setupFullSuccess(prisma, executor);
    const runner = makeRunner(prisma, executor);
    await runner.execute(makeContext());
    expect(executor.execFile).toHaveBeenCalledTimes(1);
    const call = executor.execFile.mock.calls[0];
    expect(call[0]).toBe('buildctl');
    const argv = call[1];
    expect(argv[0]).toBe('--addr');
    expect(argv[1]).toBe('tcp://buildkit.example.com:1234');
    expect(argv[2]).toBe('build');
    expect(argv[3]).toBe('--frontend');
    expect(argv[4]).toBe('dockerfile.v0');
    expect(argv[5]).toBe('--local');
    expect(argv[6]).toBe('context=/tmp/launchly-builds/deploy-1');
    expect(argv[7]).toBe('--local');
    expect(argv[8]).toBe('dockerfile=/tmp/launchly-builds/deploy-1');
    const optIdx = argv.indexOf('--opt');
    expect(argv[optIdx + 1]).toBe('filename=Dockerfile');
    const outIdx = argv.indexOf('--output');
    expect(argv[outIdx + 1]).toMatch(/^type=image,name=project\.example\.com\/team\/app:abc1234-deploy-1,push=true$/);
    const metaIdx = argv.indexOf('--metadata-file');
    expect(argv[metaIdx + 1]).toBe('/tmp/launchly-builds/deploy-1/build-metadata.json');
    expect(call[2].timeout).toBe(1800);
  });

  it('stageLogCallback fires exactly once with the redacted-tag message', async () => {
    const prisma = makePrismaDouble();
    const executor = makeExecutor();
    setupFullSuccess(prisma, executor);
    const runner = makeRunner(prisma, executor);
    const ctx = makeContext();
    await runner.execute(ctx);
    expect(ctx.stageLogCallback).toHaveBeenCalledTimes(1);
    expect(ctx.stageLogCallback).toHaveBeenCalledWith(
      'RUNNING',
      'Building and pushing immutable image project.example.com/team/app:<redacted-tag>...',
    );
  });

  it('stageLogCallback fires BEFORE the executor call (current ordering)', async () => {
    const prisma = makePrismaDouble();
    const executor = makeExecutor();
    setupFullSuccess(prisma, executor);
    const runner = makeRunner(prisma, executor);
    const ctx = makeContext();
    const order: string[] = [];
    (ctx.stageLogCallback as vi.Mock).mockImplementation(async () => {
      order.push('cb');
    });
    // Replace setupFullSuccess's mockResolvedValueOnce with a single mockImplementation so the impl is unambiguous.
    (executor.execFile as vi.Mock).mockReset();
    (executor.execFile as vi.Mock).mockImplementationOnce(async () => {
      order.push('execFile');
      return { stdout: '', stderr: '', exitCode: 0 };
    });
    const result = await runner.execute(ctx);
    expect(result.success).toBe(true);
    expect(order).toEqual(['cb', 'execFile']);
  });

  it('propagates stageLogCallback rejection and never starts buildctl', async () => {
    process.env.LAUNCHLY_BUILDKIT_ADDR = 'tcp://buildkit.example.com:1234';
    const prisma = makePrismaDouble();
    prisma.deployment.findUnique.mockResolvedValueOnce({
      id: 'deploy-1',
      projectId: 'proj-1',
      commitSha: 'abc1234',
      project: { registryRepository: 'project.example.com/team/app' },
    });
    fsMock.existsSync.mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValueOnce(true);
    const executor = makeExecutor();
    const ctx = makeContext();
    (ctx.stageLogCallback as vi.Mock).mockRejectedValueOnce(new Error('stage log unavailable'));
    const runner = makeRunner(prisma, executor);

    await expect(runner.execute(ctx)).rejects.toThrow('stage log unavailable');

    expect(executor.execFile).not.toHaveBeenCalled();
    expect(fsMock.readFileSync).not.toHaveBeenCalled();
    expect(prisma.artifact.upsert).not.toHaveBeenCalled();
    expect(prisma.deployment.update).not.toHaveBeenCalled();
  });

  it('buildctl non-zero exit: returns failure with executor result and error message', async () => {
    process.env.LAUNCHLY_BUILDKIT_ADDR = 'tcp://buildkit.example.com:1234';
    const prisma = makePrismaDouble();
    prisma.deployment.findUnique.mockResolvedValueOnce({
      id: 'deploy-1',
      projectId: 'proj-1',
      commitSha: 'abc1234',
      project: { registryRepository: 'project.example.com/team/app' },
    });
    fsMock.existsSync.mockReturnValue(true);
    const executor = makeExecutor();
    executor.execFile.mockResolvedValueOnce({ stdout: 'partial', stderr: 'denied', exitCode: 137 });
    const runner = makeRunner(prisma, executor);
    const result = await runner.execute(makeContext());
    expect(result).toEqual({
      success: false,
      stdout: 'partial',
      stderr: 'denied',
      exitCode: 137,
      errorMessage: 'BuildKit build or registry push failed',
    });
    expect(prisma.artifact.upsert).not.toHaveBeenCalled();
    expect(prisma.deployment.update).not.toHaveBeenCalled();
  });

  it('redacts buildctl secrets in a non-zero result', async () => {
    process.env.LAUNCHLY_BUILDKIT_ADDR = 'tcp://buildkit.example.com:1234';
    const prisma = makePrismaDouble();
    prisma.deployment.findUnique.mockResolvedValueOnce({
      id: 'deploy-1',
      projectId: 'proj-1',
      commitSha: 'abc1234',
      project: { registryRepository: 'project.example.com/team/app' },
    });
    fsMock.existsSync.mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValueOnce(true);
    const executor = makeExecutor();
    executor.execFile.mockResolvedValueOnce({ stdout: 'password=hunter2', stderr: 'token=plain-token', exitCode: 1 });
    const runner = makeRunner(prisma, executor);

    const result = await runner.execute(makeContext());

    expect(result.stdout).not.toContain('hunter2');
    expect(result.stderr).not.toContain('plain-token');
    expect(result.stdout).toContain('[REDACTED]');
    expect(result.stderr).toContain('[REDACTED]');
    expect(result.errorMessage).toBe('BuildKit build or registry push failed');
  });

  it('executor throws (rejects): propagates the original rejection (current behavior: no try/catch around execFile)', async () => {
    process.env.LAUNCHLY_BUILDKIT_ADDR = 'tcp://buildkit.example.com:1234';
    const prisma = makePrismaDouble();
    prisma.deployment.findUnique.mockResolvedValueOnce({
      id: 'deploy-1',
      projectId: 'proj-1',
      commitSha: 'abc1234',
      project: { registryRepository: 'project.example.com/team/app' },
    });
    fsMock.existsSync.mockReturnValue(true);
    const executor = makeExecutor();
    (executor.execFile as vi.Mock).mockImplementationOnce(() => Promise.reject(new Error('spawn ENOENT buildctl')));
    const runner = makeRunner(prisma, executor);
    await expect(runner.execute(makeContext())).rejects.toThrow('spawn ENOENT buildctl');
    expect(prisma.artifact.upsert).not.toHaveBeenCalled();
    expect(prisma.deployment.update).not.toHaveBeenCalled();
  });
});

// ─── E. Metadata parsing and digest validation ────────────────────────────

describe('BuildkitRunner.execute - metadata parsing and strict digest validation', () => {
  function setupWithMetadata(metadata: any) {
    process.env.LAUNCHLY_BUILDKIT_ADDR = 'tcp://buildkit.example.com:1234';
    const prisma = makePrismaDouble();
    const executor = makeExecutor();
    prisma.deployment.findUnique.mockResolvedValueOnce({
      id: 'deploy-1',
      projectId: 'proj-1',
      commitSha: 'abc1234',
      project: { registryRepository: 'project.example.com/team/app' },
    });
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValueOnce(typeof metadata === 'string' ? metadata : JSON.stringify(metadata));
    executor.execFile.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 });
    return { prisma, executor };
  }

  it('reads containerimage.digest on success', async () => {
    const { prisma, executor } = setupWithMetadata({ 'containerimage.digest': `sha256:${FIXED_DIGEST}` });
    prisma.artifact.upsert.mockResolvedValueOnce({ id: 'a' });
    prisma.deployment.update.mockResolvedValueOnce({ id: 'd' });
    const runner = makeRunner(prisma, executor);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(true);
    expect(prisma.artifact.upsert.mock.calls[0][0].create.digest).toBe(`sha256:${FIXED_DIGEST}`);
  });

  it('falls back to containerimage.config.digest when primary is missing', async () => {
    const { prisma, executor } = setupWithMetadata({ 'containerimage.config.digest': `sha256:${FIXED_DIGEST}` });
    prisma.artifact.upsert.mockResolvedValueOnce({ id: 'a' });
    prisma.deployment.update.mockResolvedValueOnce({ id: 'd' });
    const runner = makeRunner(prisma, executor);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(true);
    expect(prisma.artifact.upsert.mock.calls[0][0].create.digest).toBe(`sha256:${FIXED_DIGEST}`);
  });

  it('metadata read fails: failure without artifact/deployment writes', async () => {
    process.env.LAUNCHLY_BUILDKIT_ADDR = 'tcp://buildkit.example.com:1234';
    const prisma = makePrismaDouble();
    prisma.deployment.findUnique.mockResolvedValueOnce({
      id: 'deploy-1',
      projectId: 'proj-1',
      commitSha: 'abc1234',
      project: { registryRepository: 'project.example.com/team/app' },
    });
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockImplementationOnce(() => {
      throw new Error('ENOENT');
    });
    const executor = makeExecutor();
    executor.execFile.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 });
    const runner = makeRunner(prisma, executor);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('BuildKit did not return an OCI image digest');
    expect(prisma.artifact.upsert).not.toHaveBeenCalled();
  });

  it('non-JSON metadata: failure', async () => {
    const { prisma, executor } = setupWithMetadata('not json {');
    const runner = makeRunner(prisma, executor);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('BuildKit did not return an OCI image digest');
  });

  it('metadata with missing digest fields: failure', async () => {
    const { prisma, executor } = setupWithMetadata({ someOther: 'value' });
    const runner = makeRunner(prisma, executor);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('BuildKit did not return an OCI image digest');
  });

  it('metadata with non-string digest: failure', async () => {
    const { prisma, executor } = setupWithMetadata({ 'containerimage.digest': 12345 });
    const runner = makeRunner(prisma, executor);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('BuildKit did not return an OCI image digest');
  });

  it('non-sha256 digest prefix: failure', async () => {
    const { prisma, executor } = setupWithMetadata({ 'containerimage.digest': `sha512:${FIXED_DIGEST}` });
    const runner = makeRunner(prisma, executor);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('BuildKit did not return an OCI image digest');
  });

  it.each([
    ['63-char sha256', `sha256:${'a'.repeat(63)}`],
    ['65-char sha256', `sha256:${'a'.repeat(65)}`],
    ['sha256 with non-hex characters', `sha256:${'z'.repeat(64)}`],
  ])('rejects malformed digest: %s', (_label, digest) => {
    const { prisma, executor } = setupWithMetadata({ 'containerimage.digest': digest });
    prisma.artifact.upsert.mockResolvedValueOnce({ id: 'a' });
    prisma.deployment.update.mockResolvedValueOnce({ id: 'd' });
    const runner = makeRunner(prisma, executor);
    return runner.execute(makeContext()).then((result) => {
      expect(result.success).toBe(false);
      expect(result.errorMessage).toBe('BuildKit did not return an OCI image digest');
      expect(prisma.artifact.upsert).not.toHaveBeenCalled();
    });
  });
});

// ─── F. Artifact upsert and Deployment update ────────────────────────────

describe('BuildkitRunner.execute - data writes', () => {
  function setupFullSuccess(prisma: any, executor: any) {
    process.env.LAUNCHLY_BUILDKIT_ADDR = 'tcp://buildkit.example.com:1234';
    prisma.deployment.findUnique.mockResolvedValueOnce({
      id: 'deploy-1',
      projectId: 'proj-1',
      commitSha: 'feedface',
      project: { registryRepository: 'project.example.com/team/app' },
    });
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValueOnce(metadataJson(`sha256:${FIXED_DIGEST}`));
    executor.execFile.mockResolvedValueOnce({ stdout: 'build-stdout', stderr: 'build-stderr', exitCode: 0 });
  }

  it('artifact.upsert writes the complete where/create/update payload', async () => {
    const prisma = makePrismaDouble();
    const executor = makeExecutor();
    setupFullSuccess(prisma, executor);
    prisma.artifact.upsert.mockResolvedValueOnce({ id: 'a' });
    prisma.deployment.update.mockResolvedValueOnce({ id: 'd' });
    const runner = makeRunner(prisma, executor);
    await runner.execute(makeContext());
    const upsertCall = prisma.artifact.upsert.mock.calls[0][0];
    expect(upsertCall.where).toEqual({
      projectId_digest: { projectId: 'proj-1', digest: `sha256:${FIXED_DIGEST}` },
    });
    expect(upsertCall.create).toEqual({
      deploymentId: 'deploy-1',
      projectId: 'proj-1',
      imageRef: 'project.example.com/team/app',
      digest: `sha256:${FIXED_DIGEST}`,
      commitSha: 'feedface',
      sbomStatus: 'PENDING',
    });
    expect(upsertCall.update).toEqual({
      imageRef: 'project.example.com/team/app',
      digest: `sha256:${FIXED_DIGEST}`,
      commitSha: 'feedface',
    });
  });

  it('deployment.update writes artifactDigest exactly', async () => {
    const prisma = makePrismaDouble();
    const executor = makeExecutor();
    setupFullSuccess(prisma, executor);
    prisma.artifact.upsert.mockResolvedValueOnce({ id: 'a' });
    prisma.deployment.update.mockResolvedValueOnce({ id: 'd' });
    const runner = makeRunner(prisma, executor);
    await runner.execute(makeContext());
    expect(prisma.deployment.update).toHaveBeenCalledWith({
      where: { id: 'deploy-1' },
      data: { artifactId: 'a', artifactDigest: `sha256:${FIXED_DIGEST}` },
    });
  });

  it('artifact.upsert is called BEFORE deployment.update (the non-atomic ordering fixed by KI-031)', async () => {
    const prisma = makePrismaDouble();
    const executor = makeExecutor();
    const order: string[] = [];
    process.env.LAUNCHLY_BUILDKIT_ADDR = 'tcp://buildkit.example.com:1234';
    prisma.deployment.findUnique.mockResolvedValueOnce({
      id: 'deploy-1',
      projectId: 'proj-1',
      commitSha: 'feedface',
      project: { registryRepository: 'project.example.com/team/app' },
    });
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValueOnce(metadataJson(`sha256:${FIXED_DIGEST}`));
    executor.execFile.mockResolvedValueOnce({ stdout: 'build-stdout', stderr: 'build-stderr', exitCode: 0 });
    (prisma.artifact.upsert as vi.Mock).mockImplementation(async () => {
      order.push('upsert');
      return { id: 'a' };
    });
    (prisma.deployment.update as vi.Mock).mockImplementation(async () => {
      order.push('update');
      return { id: 'd' };
    });
    const runner = makeRunner(prisma, executor);
    await runner.execute(makeContext());
    expect(order).toEqual(['upsert', 'update']);
  });

  it('artifact.upsert throws: propagates the original rejection, deployment.update is NOT called (current non-atomic behavior, no try/catch)', async () => {
    const prisma = makePrismaDouble();
    const executor = makeExecutor();
    process.env.LAUNCHLY_BUILDKIT_ADDR = 'tcp://buildkit.example.com:1234';
    prisma.deployment.findUnique.mockResolvedValueOnce({
      id: 'deploy-1',
      projectId: 'proj-1',
      commitSha: 'feedface',
      project: { registryRepository: 'project.example.com/team/app' },
    });
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValueOnce(metadataJson(`sha256:${FIXED_DIGEST}`));
    executor.execFile.mockResolvedValueOnce({ stdout: 'build-stdout', stderr: 'build-stderr', exitCode: 0 });
    (prisma.artifact.upsert as vi.Mock).mockImplementationOnce(() => Promise.reject(new Error('unique violation')));
    const runner = makeRunner(prisma, executor);
    await expect(runner.execute(makeContext())).rejects.toThrow('unique violation');
    expect(prisma.deployment.update).not.toHaveBeenCalled();
  });

  it('deployment.update throws after artifact.upsert succeeded (current non-atomic behavior, KI-031, no try/catch)', async () => {
    const prisma = makePrismaDouble();
    const executor = makeExecutor();
    process.env.LAUNCHLY_BUILDKIT_ADDR = 'tcp://buildkit.example.com:1234';
    prisma.deployment.findUnique.mockResolvedValueOnce({
      id: 'deploy-1',
      projectId: 'proj-1',
      commitSha: 'feedface',
      project: { registryRepository: 'project.example.com/team/app' },
    });
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValueOnce(metadataJson(`sha256:${FIXED_DIGEST}`));
    executor.execFile.mockResolvedValueOnce({ stdout: 'build-stdout', stderr: 'build-stderr', exitCode: 0 });
    prisma.artifact.upsert.mockResolvedValueOnce({ id: 'a' });
    (prisma.deployment.update as vi.Mock).mockImplementationOnce(() =>
      Promise.reject(new Error('deployment row locked')),
    );
    const runner = makeRunner(prisma, executor);
    await expect(runner.execute(makeContext())).rejects.toThrow('deployment row locked');
    expect(prisma.artifact.upsert).toHaveBeenCalledTimes(1);
  });

  it('success result: stdout contains OCI digest, exitCode 0, no errorMessage', async () => {
    const prisma = makePrismaDouble();
    const executor = makeExecutor();
    setupFullSuccess(prisma, executor);
    prisma.artifact.upsert.mockResolvedValueOnce({ id: 'a' });
    prisma.deployment.update.mockResolvedValueOnce({ id: 'd' });
    const runner = makeRunner(prisma, executor);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.errorMessage).toBe('');
    expect(result.stdout).toContain('build-stdout');
    expect(result.stdout).toContain(`OCI digest: sha256:${FIXED_DIGEST}`);
    expect(result.stderr).toBe('build-stderr');
    expect(fsMock.rmSync).toHaveBeenCalledWith('/tmp/launchly-builds/deploy-1', { recursive: true, force: true });
  });
});

// ─── G. Path boundary ─────────────────────────────────────────────────────

describe('BuildkitRunner.execute - refId path boundary', () => {
  it.each(['../escape-1', 'deploy with space', 'deploy:tag', 'deploy@digest'])(
    'rejects unsafe refId %s before database, filesystem, or executor access',
    async (refId) => {
      const prisma = makePrismaDouble();
      const executor = makeExecutor();
      const runner = makeRunner(prisma, executor);

      const result = await runner.execute(makeContext({ refId }));

      expect(result.success).toBe(false);
      expect(result.errorMessage).toMatch(/refId/);
      expect(prisma.deployment.findUnique).not.toHaveBeenCalled();
      expect(executor.execFile).not.toHaveBeenCalled();
      expect(fsMock.existsSync).not.toHaveBeenCalled();
    },
  );
});

// ─── H. Private registry credentials ─────────────────────────────────────

describe('BuildkitRunner.execute - registry authentication', () => {
  function setup(prisma: any, executor: any, exitCode = 0) {
    process.env.LAUNCHLY_BUILDKIT_ADDR = 'tcp://buildkit.example.com:1234';
    process.env.LAUNCHLY_REGISTRY_AUTH_JSON = JSON.stringify({
      auths: { 'registry.example.com': { auth: 'dXNlcjpwYXNz' } },
    });
    prisma.deployment.findUnique.mockResolvedValueOnce({
      id: 'deploy-1',
      projectId: 'proj-1',
      commitSha: 'abc1234',
      project: { registryRepository: 'registry.example.com/team/app' },
    });
    fsMock.existsSync.mockReturnValue(true);
    fsMock.rmSync.mockReturnValue(undefined);
    fsMock.mkdirSync.mockReturnValue(undefined);
    fsMock.writeFileSync.mockReturnValue(undefined);
    fsMock.readFileSync.mockReturnValueOnce(metadataJson(`sha256:${FIXED_DIGEST}`));
    executor.execFile.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode });
    prisma.artifact.upsert.mockResolvedValueOnce({ id: 'artifact-1' });
    prisma.deployment.update.mockResolvedValueOnce({ id: 'deploy-1' });
  }

  it('writes a mode-0600 Docker config outside the source context and passes only its directory', async () => {
    const prisma = makePrismaDouble();
    const executor = makeExecutor();
    setup(prisma, executor);

    const result = await makeRunner(prisma, executor).execute(makeContext());

    expect(result.success).toBe(true);
    expect(fsMock.mkdirSync).toHaveBeenCalledWith('/tmp/launchly-builds/.registry-auth-deploy-1', {
      recursive: true,
      mode: 0o700,
    });
    expect(fsMock.writeFileSync).toHaveBeenCalledWith(
      '/tmp/launchly-builds/.registry-auth-deploy-1/config.json',
      process.env.LAUNCHLY_REGISTRY_AUTH_JSON,
      { mode: 0o600 },
    );
    expect(executor.execFile.mock.calls[0][2]).toEqual({
      timeout: 1800,
      env: { DOCKER_CONFIG: '/tmp/launchly-builds/.registry-auth-deploy-1' },
    });
    expect(JSON.stringify(executor.execFile.mock.calls[0])).not.toContain('dXNlcjpwYXNz');
    expect(fsMock.rmSync).toHaveBeenCalledWith('/tmp/launchly-builds/.registry-auth-deploy-1', {
      recursive: true,
      force: true,
    });
  });

  it('removes credentials but preserves the source context when BuildKit fails', async () => {
    const prisma = makePrismaDouble();
    const executor = makeExecutor();
    setup(prisma, executor, 1);

    const result = await makeRunner(prisma, executor).execute(makeContext());

    expect(result.success).toBe(false);
    expect(fsMock.rmSync).toHaveBeenCalledWith('/tmp/launchly-builds/.registry-auth-deploy-1', {
      recursive: true,
      force: true,
    });
    expect(fsMock.rmSync).not.toHaveBeenCalledWith('/tmp/launchly-builds/deploy-1', { recursive: true, force: true });
  });

  it('rejects malformed JSON without invoking BuildKit or writing credentials', async () => {
    process.env.LAUNCHLY_BUILDKIT_ADDR = 'tcp://buildkit.example.com:1234';
    process.env.LAUNCHLY_REGISTRY_AUTH_JSON = '{not-json';
    const prisma = makePrismaDouble();
    prisma.deployment.findUnique.mockResolvedValueOnce({
      id: 'deploy-1',
      projectId: 'proj-1',
      commitSha: 'abc1234',
      project: { registryRepository: 'registry.example.com/team/app' },
    });
    fsMock.existsSync.mockReturnValue(true);
    const executor = makeExecutor();

    const result = await makeRunner(prisma, executor).execute(makeContext());

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('Registry authentication configuration is not valid JSON');
    expect(executor.execFile).not.toHaveBeenCalled();
    expect(fsMock.mkdirSync).not.toHaveBeenCalled();
  });
});
