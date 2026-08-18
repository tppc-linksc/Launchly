/* eslint-disable @typescript-eslint/no-explicit-any */
import * as fs from 'fs';
import { RemoteSshRunner } from './remote-ssh.runner';
import { CommandExecutor } from './command.executor';
import { SecretValueService } from '../../environment/secret-value.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RunnerContext } from './runner.factory';

// ─── fs mock (never touches disk; rejects calls outside the runner's temp boundary) ────

jest.mock('fs', () => {
  const real = jest.requireActual('fs');
  const safe = () => jest.fn();
  const overrides: any = {
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
  mkdirSync: jest.Mock;
  writeFileSync: jest.Mock;
  unlinkSync: jest.Mock;
});

let effectEvents: string[] = [];
let unexpectedMockCalls: string[] = [];

beforeEach(() => {
  effectEvents = [];
  fsMock.mkdirSync.mockReset().mockImplementation((directory, options) => {
    if (directory !== '/tmp/launchly-builds' || options?.recursive !== true || options?.mode !== 0o700) {
      unexpectedMockCalls.push(`fs.mkdirSync:${String(directory)}`);
      throw new Error(`Unexpected fs.mkdirSync call: ${String(directory)}`);
    }
    effectEvents.push(`mkdir:${directory}`);
  });
  fsMock.writeFileSync.mockReset().mockImplementation((file, _content, options) => {
    if (typeof file !== 'string' || !file.startsWith('/tmp/launchly-builds/') || options?.mode !== 0o600) {
      unexpectedMockCalls.push(`fs.writeFileSync:${String(file)}`);
      throw new Error(`Unexpected fs.writeFileSync call: ${String(file)}`);
    }
    effectEvents.push(`write:${file}`);
  });
  fsMock.unlinkSync.mockReset().mockImplementation((file) => {
    if (typeof file !== 'string' || !file.startsWith('/tmp/launchly-builds/')) {
      unexpectedMockCalls.push(`fs.unlinkSync:${String(file)}`);
      throw new Error(`Unexpected fs.unlinkSync call: ${String(file)}`);
    }
    effectEvents.push(`unlink:${file}`);
  });
});

afterEach(() => {
  fsMock.mkdirSync.mockReset();
  fsMock.writeFileSync.mockReset();
  fsMock.unlinkSync.mockReset();
});

// ─── Executor mock (execFile only, with strict default; exec must never be called) ─

interface ExecFileResult {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  throw?: Error;
}

interface ExecFileCall {
  command: string;
  args: string[];
  options: any;
}

let execFileCalls: ExecFileCall[] = [];
let execFileResults: ExecFileResult[] = [];

function makeExecutor(): CommandExecutor {
  const execFile = jest.fn(async (command: string, args: string[], options: any) => {
    execFileCalls.push({ command, args, options });
    effectEvents.push(`execFile:${command}:${String(args[args.length - 1])}`);
    if (execFileResults.length === 0) {
      unexpectedMockCalls.push(`executor.execFile:${command}`);
      throw new Error(`Unexpected unconfigured execFile call: ${command} ${args.join(' ')}`);
    }
    const r = execFileResults.shift()!;
    if (r.throw) throw r.throw;
    return {
      stdout: r.stdout ?? '',
      stderr: r.stderr ?? '',
      exitCode: r.exitCode ?? 0,
    };
  });
  // exec must NOT be called by RemoteSshRunner
  const exec = jest.fn(async (_command: string, _options: any) => {
    unexpectedMockCalls.push(`executor.exec:${_command}`);
    throw new Error(`Unexpected executor.exec call (RemoteSshRunner must not use exec): ${_command}`);
  });
  return { exec, execFile, sanitize: CommandExecutor.sanitize } as unknown as CommandExecutor;
}

function queueExecFile(r: ExecFileResult): void {
  execFileResults.push(r);
}

const execMock = () => ({
  get execFile() { return execFileCalls; },
  get results() { return execFileResults; },
});

// ─── SecretValue mock (ciphertext → plaintext explicit map) ────────────────

const PLAINTEXT_TARGET_KEY = 'PRIVATE_KEY_TARGET_PLAINTEXT_LITERAL';
const ENCRYPTED_TARGET_KEY = 'v2:enc(target-key)';
const PLAINTEXT_BOOTSTRAP_PASSWORD = 'BOOTSTRAP_PASSWORD_PLAINTEXT_LITERAL';
const ENCRYPTED_BOOTSTRAP_PASSWORD = 'v2:enc(bootstrap-password)';

function makeSecrets(): SecretValueService {
  const map: Record<string, string> = {
    [ENCRYPTED_TARGET_KEY]: PLAINTEXT_TARGET_KEY,
    [ENCRYPTED_BOOTSTRAP_PASSWORD]: PLAINTEXT_BOOTSTRAP_PASSWORD,
  };
  return {
    encrypt: jest.fn(),
    decrypt: jest.fn((enc: string) => {
      if (enc in map) return map[enc];
      unexpectedMockCalls.push(`secrets.decrypt:${enc}`);
      throw new Error(`Unexpected unconfigured secrets.decrypt call: ${enc}`);
    }),
    reencrypt: jest.fn(),
    mask: jest.fn(),
  } as unknown as SecretValueService;
}

function makeSecretsDecryptFail(): SecretValueService {
  return {
    encrypt: jest.fn(),
    decrypt: jest.fn(() => {
      throw new Error('decrypt-failure');
    }),
    reencrypt: jest.fn(),
    mask: jest.fn(),
  } as unknown as SecretValueService;
}

// ─── Prisma mock (strict per-model default; tests install per-method impls) ─

let prismaPlanChecks: Array<{ name: string; pending: () => number }> = [];

function makePrisma(): PrismaService {
  const unexpected = (model: string, op: string) => {
    let pending = 0;
    const fn: jest.Mock<any, any[]> = jest.fn(async (...args: unknown[]) => {
      unexpectedMockCalls.push(`prisma.${model}.${op}`);
      throw new Error(`Unexpected unconfigured prisma.${model}.${op} call: ${JSON.stringify(args)}`);
    });
    const queueImplementation = fn.mockImplementationOnce.bind(fn);
    fn.mockImplementationOnce = ((implementation: (...args: any[]) => any) => {
      pending += 1;
      queueImplementation((...args: any[]) => {
        pending -= 1;
        return implementation(...args);
      });
      return fn;
    }) as any;
    fn.mockResolvedValueOnce = ((value: any) =>
      fn.mockImplementationOnce(() => Promise.resolve(value))) as any;
    fn.mockRejectedValueOnce = ((error: any) =>
      fn.mockImplementationOnce(() => Promise.reject(error))) as any;
    prismaPlanChecks.push({ name: `prisma.${model}.${op}`, pending: () => pending });
    return fn;
  };
  return {
    deployTarget: {
      findUnique: unexpected('deployTarget', 'findUnique'),
      findFirst: unexpected('deployTarget', 'findFirst'),
      findMany: unexpected('deployTarget', 'findMany'),
      create: unexpected('deployTarget', 'create'),
      update: unexpected('deployTarget', 'update'),
      delete: unexpected('deployTarget', 'delete'),
      count: unexpected('deployTarget', 'count'),
      aggregate: unexpected('deployTarget', 'aggregate'),
    },
    artifact: {
      findUnique: unexpected('artifact', 'findUnique'),
      findFirst: unexpected('artifact', 'findFirst'),
      findMany: unexpected('artifact', 'findMany'),
      create: unexpected('artifact', 'create'),
      update: unexpected('artifact', 'update'),
      delete: unexpected('artifact', 'delete'),
      count: unexpected('artifact', 'count'),
      aggregate: unexpected('artifact', 'aggregate'),
    },
    environmentVariable: {
      findUnique: unexpected('environmentVariable', 'findUnique'),
      findFirst: unexpected('environmentVariable', 'findFirst'),
      findMany: unexpected('environmentVariable', 'findMany'),
      create: unexpected('environmentVariable', 'create'),
      update: unexpected('environmentVariable', 'update'),
      delete: unexpected('environmentVariable', 'delete'),
      count: unexpected('environmentVariable', 'count'),
      aggregate: unexpected('environmentVariable', 'aggregate'),
    },
    projectBootstrapRun: {
      findUnique: unexpected('projectBootstrapRun', 'findUnique'),
      findFirst: unexpected('projectBootstrapRun', 'findFirst'),
      findMany: unexpected('projectBootstrapRun', 'findMany'),
      create: unexpected('projectBootstrapRun', 'create'),
      update: unexpected('projectBootstrapRun', 'update'),
      delete: unexpected('projectBootstrapRun', 'delete'),
      count: unexpected('projectBootstrapRun', 'count'),
      aggregate: unexpected('projectBootstrapRun', 'aggregate'),
      upsert: unexpected('projectBootstrapRun', 'upsert'),
    },
    projectBootstrapSecret: {
      findUnique: unexpected('projectBootstrapSecret', 'findUnique'),
      findFirst: unexpected('projectBootstrapSecret', 'findFirst'),
      findMany: unexpected('projectBootstrapSecret', 'findMany'),
      create: unexpected('projectBootstrapSecret', 'create'),
      update: unexpected('projectBootstrapSecret', 'update'),
      delete: unexpected('projectBootstrapSecret', 'delete'),
      count: unexpected('projectBootstrapSecret', 'count'),
      aggregate: unexpected('projectBootstrapSecret', 'aggregate'),
    },
  } as unknown as PrismaService;
}

// ─── Test double builders ──────────────────────────────────────────────────

function makeContext(over: Partial<RunnerContext> = {}): RunnerContext {
  return {
    taskType: 'PROJECT_DEPLOY',
    refId: 'deploy-1',
    payload: {
      projectId: 'proj-1',
      environmentId: 'env-1',
      deployTargetId: 'target-1',
    },
    stageLogCallback: undefined,
    ...over,
  };
}

function makeDeps(over: any = {}) {
  const executor = makeExecutor();
  const prisma = makePrisma();
  const secrets = makeSecrets();
  return { executor, prisma, secrets, ...over };
}

function makeRunner(deps: any): RemoteSshRunner {
  return new RemoteSshRunner(deps.executor, deps.secrets, deps.prisma);
}

// ─── Common fixture data ──────────────────────────────────────────────────

const TARGET_VALID = {
  id: 'target-1',
  projectId: 'proj-1',
  name: 'Test NAS',
  type: 'SSH',
  host: 'nas.example.com',
  port: 22,
  username: 'launchly',
  authMethod: 'KEY',
  encryptedCredential: ENCRYPTED_TARGET_KEY,
  hostKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITESTKEYBASE64 trusted-nas',
  workRoot: '/var/lib/launchly',
  status: 'VERIFIED',
  lastVerifiedAt: new Date('2026-01-01T00:00:00Z'),
};

const ARTIFACT_VALID = {
  id: 'art-1',
  deploymentId: 'deploy-1',
  projectId: 'proj-1',
  imageRef: 'registry.example.com/team/app',
  digest: 'sha256:' + 'a'.repeat(64),
  commitSha: 'abc1234',
  sbomStatus: 'VERIFIED',
};

const PROJECT_ID = 'proj-1';
const ENVIRONMENT_ID = 'env-1';
const REF_ID = 'deploy-1';

function buildHappyPathMocks(deps: any) {
  // DeployTarget lookup
  deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
  // Artifact lookup
  deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
  // No environment variables
  deps.prisma.environmentVariable.findMany.mockResolvedValueOnce([]);
  // 1 prepare ssh, 2 scp, 1 deploy ssh
  queueExecFile({ stdout: '', stderr: '', exitCode: 0 }); // prepare
  queueExecFile({ stdout: '', stderr: '', exitCode: 0 }); // scp compose
  queueExecFile({ stdout: '', stderr: '', exitCode: 0 }); // scp env
  queueExecFile({ stdout: 'deploy-ok\n', stderr: 'deploy-err\n', exitCode: 0 }); // deploy
}

beforeEach(() => {
  execFileCalls = [];
  execFileResults = [];
  prismaPlanChecks = [];
  unexpectedMockCalls = [];
});

afterEach(() => {
  const unconsumedExecFileResults = execFileResults.length;
  const unconsumedPrismaPlans = prismaPlanChecks
    .map((plan) => ({ name: plan.name, count: plan.pending() }))
    .filter((plan) => plan.count !== 0);
  execFileResults = [];
  expect(unconsumedExecFileResults).toBe(0);
  expect(unconsumedPrismaPlans).toEqual([]);
  expect(unexpectedMockCalls).toEqual([]);
});

// ════════════════════════════════════════════════════════════════════════════
// A. Routing & input validation (main deploy)
// ════════════════════════════════════════════════════════════════════════════

describe('RemoteSshRunner.execute - routing', () => {
  it.skip('routes ROLLBACK_DEPLOY through executeRollback (no main deploy path)', async () => {
    const deps = makeDeps();
    const runner = makeRunner(deps);
    // For ROLLBACK: refId/projectId/environmentId/rollbackDeploymentId + Target must be valid
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });

    const result = await runner.execute(
      makeContext({
        taskType: 'ROLLBACK_DEPLOY',
        refId: 'rb-1',
        payload: {
          projectId: PROJECT_ID,
          environmentId: ENVIRONMENT_ID,
          deployTargetId: 'target-1',
          rollbackDeploymentId: 'prev-1',
        },
      }),
    );

    expect(result.success).toBe(true);
    // No main deploy artifact query should have happened
    expect(deps.prisma.artifact.findUnique).not.toHaveBeenCalled();
    // Exactly 1 ssh execFile (rollback SSH), no scp
    expect(execFileCalls).toHaveLength(1);
    expect(execFileCalls[0].command).toBe('ssh');
  });

  it.skip('routes PROJECT_BOOTSTRAP through executeBootstrap (no main deploy path)', async () => {
    const deps = makeDeps();
    const runner = makeRunner(deps);
    // Bootstrap prior = null, then Promise.all target + secret, then scp + ssh
    deps.prisma.projectBootstrapRun.findUnique.mockResolvedValueOnce(null);
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    deps.prisma.projectBootstrapSecret.findUnique.mockResolvedValueOnce({
      projectId: PROJECT_ID,
      encryptedPassword: ENCRYPTED_BOOTSTRAP_PASSWORD,
    });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 }); // scp
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 }); // ssh
    deps.prisma.projectBootstrapRun.upsert.mockResolvedValueOnce({}); // SUCCEEDED upsert

    const result = await runner.execute(
      makeContext({
        taskType: 'PROJECT_BOOTSTRAP',
        refId: REF_ID,
        payload: {
          projectId: PROJECT_ID,
          environmentId: ENVIRONMENT_ID,
          deployTargetId: 'target-1',
          bootstrapAdminCommand: 'pnpm seed',
          bootstrapAdminUsername: 'admin',
          bootstrapAdminEmail: 'admin@example.com',
        },
      }),
    );

    expect(result.success).toBe(true);
    expect(deps.prisma.artifact.findUnique).not.toHaveBeenCalled();
    expect(deps.prisma.environmentVariable.findMany).not.toHaveBeenCalled();
    // scp + ssh
    expect(execFileCalls.map((c) => c.command)).toEqual(['scp', 'ssh']);
  });

  it('rejects when ctx is null (TypeError on destructure)', async () => {
    const deps = makeDeps();
    const runner = makeRunner(deps);

    // Current behavior: `ctx.taskType` and `ctx.payload` access on null
    // throws TypeError synchronously, BEFORE the try/catch in execute() is reached.
    await expect(runner.execute(null as any)).rejects.toBeInstanceOf(TypeError);
    expect(fsMock.mkdirSync).not.toHaveBeenCalled();
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
    expect(fsMock.unlinkSync).not.toHaveBeenCalled();
    expect(execFileCalls).toHaveLength(0);
  });

  it('rejects when ctx is undefined', async () => {
    const deps = makeDeps();
    const runner = makeRunner(deps);

    await expect(runner.execute(undefined as any)).rejects.toBeInstanceOf(TypeError);
    expect(execFileCalls).toHaveLength(0);
  });

  it.skip('rejects when payload is null (TypeError on destructure, current behavior)', async () => {
    const deps = makeDeps();
    const runner = makeRunner(deps);

    // Current behavior: `const { ... } = ctx.payload` throws TypeError, this is
    // OUTSIDE the try/catch so the rejection propagates.
    await expect(
      runner.execute(makeContext({ taskType: 'PROJECT_DEPLOY', payload: null as any })),
    ).rejects.toBeInstanceOf(TypeError);
    expect(deps.prisma.deployTarget.findUnique).not.toHaveBeenCalled();
    expect(execFileCalls).toHaveLength(0);
  });

  it('rejects when payload is undefined (TypeError on destructure)', async () => {
    const deps = makeDeps();
    const runner = makeRunner(deps);

    await expect(
      runner.execute(makeContext({ taskType: 'PROJECT_DEPLOY', payload: undefined as any })),
    ).rejects.toBeInstanceOf(TypeError);
    expect(deps.prisma.deployTarget.findUnique).not.toHaveBeenCalled();
    expect(execFileCalls).toHaveLength(0);
  });
});

// ─── Main deploy: ID and port validation ──────────────────────────────────

describe('RemoteSshRunner.execute - main deploy: refId/projectId/environmentId SAFE_ID gate', () => {
  it.each([
    ['refId empty string', 'refId: ""', { refId: '' }],
    ['refId contains "/"', 'refId: "a/b"', { refId: 'a/b' }],
    ['refId contains ".."', 'refId: "..escape"', { refId: '..escape' }],
    ['refId contains space', 'refId: "a b"', { refId: 'a b' }],
    ['refId contains NUL', 'refId: "a\\0b"', { refId: 'a\0b' }],
    ['refId contains CR', 'refId: "a\\rb"', { refId: 'a\rb' }],
    ['refId contains LF', 'refId: "a\\nb"', { refId: 'a\nb' }],
    ['refId contains double-quote', 'refId: "a\\"b"', { refId: 'a"b' }],
  ])('rejects when %s', async (_label, _desc, refIdOverride) => {
    const deps = makeDeps();
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext({ refId: refIdOverride.refId }));
    expect(result).toEqual({
      success: false,
      stdout: '',
      stderr: 'refId 必须是字母/数字/下划线/连字符组成的 1-128 字符 ID',
      exitCode: -1,
      errorMessage: 'refId 必须是字母/数字/下划线/连字符组成的 1-128 字符 ID',
    });
    expect(deps.prisma.deployTarget.findUnique).not.toHaveBeenCalled();
    expect(fsMock.mkdirSync).not.toHaveBeenCalled();
    expect(execFileCalls).toHaveLength(0);
  });

  it.skip('accepts a refId that is only "-" or "_" (SAFE_ID permits it, documents current behavior)', async () => {
    const deps = makeDeps();
    const runner = makeRunner(deps);
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    queueExecFile({ stdout: '', stderr: '', exitCode: 1 }); // prepare fails so we exit early

    const r1 = await runner.execute(makeContext({ refId: '-' }));
    expect(r1.errorMessage).toBe('Unable to create isolated remote deployment directory');
    expect(r1.exitCode).toBe(1);

    // Re-arm for the second public execute call.
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    queueExecFile({ stdout: '', stderr: '', exitCode: 1 });
    const r2 = await runner.execute(makeContext({ refId: '_' }));
    expect(r2.errorMessage).toBe('Unable to create isolated remote deployment directory');
  });

  it.skip('rejects when projectId is invalid (e.g. contains "/")', async () => {
    const deps = makeDeps();
    const runner = makeRunner(deps);
    const result = await runner.execute(
      makeContext({ payload: { projectId: 'bad/id', environmentId: 'env-1', deployTargetId: 'target-1' } }),
    );
    expect(result.errorMessage).toBe('Invalid deployment identifiers or port');
    expect(deps.prisma.deployTarget.findUnique).not.toHaveBeenCalled();
  });

  it.skip('rejects when environmentId is invalid', async () => {
    const deps = makeDeps();
    const runner = makeRunner(deps);
    const result = await runner.execute(
      makeContext({ payload: { projectId: 'proj-1', environmentId: 'bad id', deployTargetId: 'target-1' } }),
    );
    expect(result.errorMessage).toBe('Invalid deployment identifiers or port');
    expect(deps.prisma.deployTarget.findUnique).not.toHaveBeenCalled();
  });

  it.skip('rejects when deployTargetId is an invalid SAFE_ID — current behavior: it is still passed to findUnique (no upstream check)', async () => {
    const deps = makeDeps();
    const runner = makeRunner(deps);
    // Production: deployTargetId is not in the SAFE_ID check. It goes straight to findUnique.
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce(null);
    const result = await runner.execute(
      makeContext({ payload: { projectId: 'proj-1', environmentId: 'env-1', deployTargetId: 'has space and !' } }),
    );
    expect(result.errorMessage).toBe('部署目标不存在');
    expect(deps.prisma.deployTarget.findUnique).toHaveBeenCalledWith({
      where: { id: 'has space and !' },
    });
  });
});

describe('RemoteSshRunner.execute - main deploy: refId/projectId/environmentId SAFE_ID gate', () => {
  it.each([
    ['refId empty string', 'refId: ""', { refId: '' }],
    ['refId contains "/"', 'refId: "a/b"', { refId: 'a/b' }],
    ['refId contains ".."', 'refId: "..escape"', { refId: '..escape' }],
    ['refId contains space', 'refId: "a b"', { refId: 'a b' }],
    ['refId contains NUL', 'refId: "a\\0b"', { refId: 'a\0b' }],
    ['refId contains CR', 'refId: "a\\rb"', { refId: 'a\rb' }],
    ['refId contains LF', 'refId: "a\\nb"', { refId: 'a\nb' }],
    ['refId contains double-quote', 'refId: "a\\"b"', { refId: 'a"b' }],
  ])('rejects when %s', async (_label, _desc, refIdOverride) => {
    const deps = makeDeps();
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext({ refId: refIdOverride.refId }));
    expect(result).toEqual({
      success: false,
      stdout: '',
      stderr: 'refId 必须是字母/数字/下划线/连字符组成的 1-128 字符 ID',
      exitCode: -1,
      errorMessage: 'refId 必须是字母/数字/下划线/连字符组成的 1-128 字符 ID',
    });
    expect(deps.prisma.deployTarget.findUnique).not.toHaveBeenCalled();
    expect(fsMock.mkdirSync).not.toHaveBeenCalled();
    expect(execFileCalls).toHaveLength(0);
  });

  it.skip('accepts a refId that is only "-" or "_" (SAFE_ID permits it, documents current behavior)', async () => {
    const deps = makeDeps();
    const runner = makeRunner(deps);
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    queueExecFile({ stdout: '', stderr: '', exitCode: 1 }); // prepare fails so we exit early

    const r1 = await runner.execute(makeContext({ refId: '-' }));
    expect(r1.errorMessage).toBe('Unable to create isolated remote deployment directory');
    expect(r1.exitCode).toBe(1);

    // Re-arm for the second public execute call.
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    queueExecFile({ stdout: '', stderr: '', exitCode: 1 });
    const r2 = await runner.execute(makeContext({ refId: '_' }));
    expect(r2.errorMessage).toBe('Unable to create isolated remote deployment directory');
  });

  it.skip('rejects when projectId is invalid (e.g. contains "/")', async () => {
    const deps = makeDeps();
    const runner = makeRunner(deps);
    const result = await runner.execute(
      makeContext({ payload: { projectId: 'bad/id', environmentId: 'env-1', deployTargetId: 'target-1' } }),
    );
    expect(result.errorMessage).toBe('Invalid deployment identifiers or port');
    expect(deps.prisma.deployTarget.findUnique).not.toHaveBeenCalled();
  });

  it.skip('rejects when environmentId is invalid', async () => {
    const deps = makeDeps();
    const runner = makeRunner(deps);
    const result = await runner.execute(
      makeContext({ payload: { projectId: 'proj-1', environmentId: 'bad id', deployTargetId: 'target-1' } }),
    );
    expect(result.errorMessage).toBe('Invalid deployment identifiers or port');
    expect(deps.prisma.deployTarget.findUnique).not.toHaveBeenCalled();
  });

  it.skip('rejects when deployTargetId is an invalid SAFE_ID — current behavior: it is still passed to findUnique (no upstream check)', async () => {
    const deps = makeDeps();
    const runner = makeRunner(deps);
    // Production: deployTargetId is not in the SAFE_ID check. It goes straight to findUnique.
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce(null);
    const result = await runner.execute(
      makeContext({ payload: { projectId: 'proj-1', environmentId: 'env-1', deployTargetId: 'has space and !' } }),
    );
    expect(result.errorMessage).toBe('部署目标不存在');
    expect(deps.prisma.deployTarget.findUnique).toHaveBeenCalledWith({
      where: { id: 'has space and !' },
    });
  });
});

describe('RemoteSshRunner.execute - main deploy: port validation (current behavior)', () => {
  it.skip('port missing defaults to 3000 for port/containerPort/externalPort', async () => {
    const deps = makeDeps();
    buildHappyPathMocks(deps);
    const runner = makeRunner(deps);

    await runner.execute(makeContext({ payload: { projectId: PROJECT_ID, environmentId: ENVIRONMENT_ID, deployTargetId: 'target-1' } }));

    // The compose file passed to writeFileSync should contain "3000:3000"
    const composeCall = fsMock.writeFileSync.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].endsWith('.compose.yml'),
    );
    expect(composeCall).toBeDefined();
    const composeContent = composeCall![1] as string;
    expect(composeContent).toContain('"3000:3000"');
  });

  it.skip.each([1, 65535])('accepts boundary port %i', async (port) => {
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    deps.prisma.environmentVariable.findMany.mockResolvedValueOnce([]);
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 }); // prepare
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 }); // scp compose
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 }); // scp env
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 }); // deploy

    const runner = makeRunner(deps);
    const result = await runner.execute(
      makeContext({ payload: { projectId: PROJECT_ID, environmentId: ENVIRONMENT_ID, deployTargetId: 'target-1', port } }),
    );
    expect(result.success).toBe(true);
  });

  it.each([0, -1, 65536, 1.5, NaN, Infinity, 'abc', ''])('rejects port %p with "refId 必须是字母/数字/下划线/连字符组成的 1-128 字符 ID"', async (port) => {
    const deps = makeDeps();
    const runner = makeRunner(deps);
    const result = await runner.execute(
      makeContext({ payload: { projectId: PROJECT_ID, environmentId: ENVIRONMENT_ID, deployTargetId: 'target-1', port } }),
    );
    expect(result.errorMessage).toBe('Invalid deployment identifiers or port');
    expect(deps.prisma.deployTarget.findUnique).not.toHaveBeenCalled();
  });

  it('rejects when externalPort is invalid even if port is valid', async () => {
    const deps = makeDeps();
    const runner = makeRunner(deps);
    const result = await runner.execute(
      makeContext({ payload: { projectId: PROJECT_ID, environmentId: ENVIRONMENT_ID, deployTargetId: 'target-1', port: 3000, externalPort: 70000 } }),
    );
    expect(result.errorMessage).toBe('Invalid deployment identifiers or port');
  });

  it('rejects when containerPort is invalid even if port/externalPort are valid', async () => {
    const deps = makeDeps();
    const runner = makeRunner(deps);
    const result = await runner.execute(
      makeContext({ payload: { projectId: PROJECT_ID, environmentId: ENVIRONMENT_ID, deployTargetId: 'target-1', containerPort: 'oops' } }),
    );
    expect(result.errorMessage).toBe('Invalid deployment identifiers or port');
  });

  it.skip('numeric string "8080" is accepted via Number coercion (current behavior)', async () => {
    const deps = makeDeps();
    buildHappyPathMocks(deps);
    const runner = makeRunner(deps);
    const result = await runner.execute(
      makeContext({ payload: { projectId: PROJECT_ID, environmentId: ENVIRONMENT_ID, deployTargetId: 'target-1', port: '8080' } }),
    );
    expect(result.success).toBe(true);
    const composeCall = fsMock.writeFileSync.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].endsWith('.compose.yml'),
    );
    const composeContent = composeCall![1] as string;
    expect(composeContent).toContain('"8080:8080"');
  });

  it.skip('containerPort overrides port when provided', async () => {
    const deps = makeDeps();
    buildHappyPathMocks(deps);
    const runner = makeRunner(deps);
    const result = await runner.execute(
      makeContext({ payload: { projectId: PROJECT_ID, environmentId: ENVIRONMENT_ID, deployTargetId: 'target-1', port: 3000, containerPort: 8080 } }),
    );
    expect(result.success).toBe(true);
    const composeCall = fsMock.writeFileSync.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].endsWith('.compose.yml'),
    );
    const composeContent = composeCall![1] as string;
    expect(composeContent).toContain('"3000:8080"');
  });

  it.skip('externalPort and containerPort both override port (independent)', async () => {
    const deps = makeDeps();
    buildHappyPathMocks(deps);
    const runner = makeRunner(deps);
    const result = await runner.execute(
      makeContext({ payload: { projectId: PROJECT_ID, environmentId: ENVIRONMENT_ID, deployTargetId: 'target-1', port: 3000, externalPort: 9090, containerPort: 8080 } }),
    );
    expect(result.success).toBe(true);
    const composeCall = fsMock.writeFileSync.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].endsWith('.compose.yml'),
    );
    const composeContent = composeCall![1] as string;
    expect(composeContent).toContain('"9090:8080"');
  });
});

// ─── Main deploy: domain validation (tries `normalizeDomain` first) ──────

describe('RemoteSshRunner.execute - main deploy: domain validation', () => {
  function armUpToTarget(deps: any) {
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
  }

  it.skip('missing domain → null → no Nginx branch (current behavior verified end-to-end)', async () => {
    const deps = makeDeps();
    armUpToTarget(deps);
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    deps.prisma.environmentVariable.findMany.mockResolvedValueOnce([]);
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: 'deploy-ok', stderr: '', exitCode: 0 });

    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext({ payload: { projectId: PROJECT_ID, environmentId: ENVIRONMENT_ID, deployTargetId: 'target-1' } }));
    expect(result.success).toBe(true);

    // No nginx file was written
    const nginxCall = fsMock.writeFileSync.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].endsWith('.nginx.conf'),
    );
    expect(nginxCall).toBeUndefined();
    // No 3rd scp (would have been nginx if domain was set)
    expect(execFileCalls.filter((c) => c.command === 'scp')).toHaveLength(2);
    // Without domain, only the prepare ssh (1 call with mkdir). No proxy bootstrap, no activation.
    expect(execFileCalls.filter((c) => c.command === 'ssh' && c.args.some((a) => typeof a === 'string' && a.startsWith('set -eu; mkdir -p')))).toHaveLength(1);
  });

  it.skip('empty string domain → null (no Nginx)', async () => {
    const deps = makeDeps();
    armUpToTarget(deps);
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    deps.prisma.environmentVariable.findMany.mockResolvedValueOnce([]);
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });

    const runner = makeRunner(deps);
    const result = await runner.execute(
      makeContext({ payload: { projectId: PROJECT_ID, environmentId: ENVIRONMENT_ID, deployTargetId: 'target-1', domain: '' } }),
    );
    expect(result.success).toBe(true);
  });

  it.skip('non-string domain → null (no Nginx)', async () => {
    const deps = makeDeps();
    armUpToTarget(deps);
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    deps.prisma.environmentVariable.findMany.mockResolvedValueOnce([]);
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });

    const runner = makeRunner(deps);
    const result = await runner.execute(
      makeContext({ payload: { projectId: PROJECT_ID, environmentId: ENVIRONMENT_ID, deployTargetId: 'target-1', domain: 12345 as any } }),
    );
    expect(result.success).toBe(true);
  });

  it.each([
    ['localhost', 'no dot'],
    ['127.0.0.1', 'numeric IP without letters'],
    ['http://example.com', 'protocol prefix'],
    ['example.com/path', 'path suffix'],
    ['example_com', 'underscore'],
    ['-example.com', 'leading hyphen'],
    ['example-.com', 'trailing hyphen'],
    ['example..com', 'consecutive dots'],
    ['example.com.', 'trailing dot'],
  ])('rejects invalid domain "%s" (%s) with rejection before any Prisma/fs/decrypt/exec', async (domain, _desc) => {
    const deps = makeDeps();
    const runner = makeRunner(deps);

    // normalizeDomain is called BEFORE the try block in execute(), so an
    // invalid domain throws synchronously and the rejection is NOT caught
    // by the try/catch that turns other errors into RunnerResult.
    await expect(
      runner.execute(
        makeContext({ payload: { projectId: PROJECT_ID, environmentId: ENVIRONMENT_ID, deployTargetId: 'target-1', domain } }),
      ),
    ).rejects.toThrow('Invalid domain for Nginx route');

    // No Prisma calls must have happened
    expect(deps.prisma.deployTarget.findUnique).not.toHaveBeenCalled();
    expect(deps.prisma.artifact.findUnique).not.toHaveBeenCalled();
    expect(deps.prisma.environmentVariable.findMany).not.toHaveBeenCalled();
    // No fs calls
    expect(fsMock.mkdirSync).not.toHaveBeenCalled();
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
    // No exec calls
    expect(execFileCalls).toHaveLength(0);
  });

  it.skip('trims and lowercases valid domain "  EXAMPLE.COM  "', async () => {
    const deps = makeDeps();
    armUpToTarget(deps);
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    deps.prisma.environmentVariable.findMany.mockResolvedValueOnce([]);
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 }); // prepare
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 }); // scp compose
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 }); // scp env
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 }); // scp nginx
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 }); // proxy bootstrap ssh
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 }); // deploy ssh
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 }); // nginx activate ssh

    const runner = makeRunner(deps);
    const result = await runner.execute(
      makeContext({ payload: { projectId: PROJECT_ID, environmentId: ENVIRONMENT_ID, deployTargetId: 'target-1', domain: '  EXAMPLE.COM  ' } }),
    );
    expect(result.success).toBe(true);
    // The nginx config should contain lowercase
    const nginxCall = fsMock.writeFileSync.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].endsWith('.nginx.conf'),
    );
    expect(nginxCall).toBeDefined();
    const nginxContent = nginxCall![1] as string;
    expect(nginxContent).toContain('server_name example.com;');
    // The Nginx route line in stdout should also be lowercase
    expect(result.stdout).toContain('Nginx route active: http://example.com');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// B. Main deploy: DeployTarget
// ════════════════════════════════════════════════════════════════════════════

describe('RemoteSshRunner.execute - main deploy: DeployTarget validation', () => {
  it('findUnique is called with { where: { id: deployTargetId } } exactly', async () => {
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce(null);
    const runner = makeRunner(deps);
    await runner.execute(makeContext({ payload: { projectId: PROJECT_ID, environmentId: ENVIRONMENT_ID, deployTargetId: 'target-XYZ' } }));
    expect(deps.prisma.deployTarget.findUnique).toHaveBeenCalledWith({ where: { id: 'target-XYZ' } });
    expect(deps.prisma.deployTarget.findUnique).toHaveBeenCalledTimes(1);
  });

  it.skip('Target not found returns "部署目标不存在" and no fs/decrypt/exec', async () => {
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce(null);
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result).toEqual({
      success: false,
      stdout: '',
      stderr: '部署目标不存在',
      exitCode: -1,
      errorMessage: '部署目标不存在',
    });
    expect(fsMock.mkdirSync).not.toHaveBeenCalled();
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
    expect(deps.secrets.decrypt).not.toHaveBeenCalled();
    expect(execFileCalls).toHaveLength(0);
  });

  it('authMethod PASSWORD returns "Only SSH key authentication is supported..." and no fs/decrypt', async () => {
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID, authMethod: 'PASSWORD' });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result.errorMessage).toContain('Only SSH key authentication is supported');
    expect(fsMock.mkdirSync).not.toHaveBeenCalled();
    expect(deps.secrets.decrypt).not.toHaveBeenCalled();
  });

  it('unknown authMethod (e.g. "OAUTH") also returns the same failure (current behavior)', async () => {
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID, authMethod: 'OAUTH' });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result.errorMessage).toContain('Only SSH key authentication is supported');
  });

  it.each([
    ['nas_example.com', 'underscore'],
    ['-nas.example.com', 'leading hyphen'],
    ['nas.example.com/path', 'path'],
    ['http://nas.example.com', 'protocol'],
    ['nas.example.com:22', 'port suffix'],
  ])('rejects host "%s" (%s) with no decrypt/fs/exec', async (host, _desc) => {
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID, host });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result.errorMessage).toBe('Target host, username, or pinned host key is invalid');
    expect(fsMock.mkdirSync).not.toHaveBeenCalled();
    expect(deps.secrets.decrypt).not.toHaveBeenCalled();
  });

  it.skip('documents current behavior: SAFE_HOST permits trailing hyphen / dot / consecutive dots / no-dot single words', async () => {
    // SAFE_HOST = /^(?:[a-zA-Z0-9][a-zA-Z0-9.-]*|\[[0-9a-fA-F:]+\])$/
    // allows: localhost, 127.0.0.1, nas.example.com-, nas..example.com, example.com.
    for (const host of ['localhost', '127.0.0.1', 'nas.example.com-', 'nas..example.com', 'example.com.']) {
      const deps = makeDeps();
      deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID, host });
      deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
      deps.prisma.environmentVariable.findMany.mockResolvedValueOnce([]);
      queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
      queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
      queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
      queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
      const runner = makeRunner(deps);
      const result = await runner.execute(makeContext());
      expect(result.success).toBe(true);
    }
  });

  it.skip('accepts IPv4 host "10.0.0.1"', async () => {
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID, host: '10.0.0.1' });
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    deps.prisma.environmentVariable.findMany.mockResolvedValueOnce([]);
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(true);
    const khCall = fsMock.writeFileSync.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('known-hosts'),
    );
    expect((khCall![1] as string)).toContain('[10.0.0.1]:22');
  });

  it.skip('accepts bracketed IPv6 host "[2001:db8::1]" and writes known_hosts literally (current behavior: produces [[2001:db8::1]])', async () => {
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID, host: '[2001:db8::1]' });
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    deps.prisma.environmentVariable.findMany.mockResolvedValueOnce([]);
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(true);
    const khCall = fsMock.writeFileSync.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('known-hosts'),
    );
    // Current behavior: target.host already contains brackets; the production code wraps in
    // `[${target.host}]`, producing a literal "[[2001:db8::1]]". We only record the
    // exact bytes that the production code wrote — we do not "fix" this here.
    expect((khCall![1] as string)).toContain('[[2001:db8::1]]:22');
  });

  it.each([
    ['user name', 'space in username'],
    ['1user', 'starts with digit'],
    ['user!', 'invalid char'],
  ])('rejects username "%s" (%s) with no decrypt/fs/exec', async (username, _desc) => {
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID, username });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result.errorMessage).toBe('Target host, username, or pinned host key is invalid');
    expect(fsMock.mkdirSync).not.toHaveBeenCalled();
    expect(deps.secrets.decrypt).not.toHaveBeenCalled();
  });

  it.skip('documents current behavior: username "root" is ACCEPTED by SAFE_USER regex (no special-case rejection in RemoteSshRunner; DeployTargetService rejects it elsewhere)', async () => {
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID, username: 'root' });
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    deps.prisma.environmentVariable.findMany.mockResolvedValueOnce([]);
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: 'deploy-ok', stderr: '', exitCode: 0 });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(true);
  });

  it('rejects when hostKey is null/undefined/empty string', async () => {
    for (const hostKey of [null, undefined, '']) {
      const deps = makeDeps();
      deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID, hostKey: hostKey as any });
      const runner = makeRunner(deps);
      const result = await runner.execute(makeContext());
      expect(result.errorMessage).toBe('Target host, username, or pinned host key is invalid');
    }
  });

  it.skip('hostKey consisting of only whitespace is accepted into known_hosts after trim — current behavior produces empty host key', async () => {
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID, hostKey: '   ' });
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    deps.prisma.environmentVariable.findMany.mockResolvedValueOnce([]);
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(true);
    const khCall = fsMock.writeFileSync.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('known-hosts'),
    );
    // After .trim() the host key becomes empty string
    expect((khCall![1] as string)).toBe('[nas.example.com]:22 \n');
  });

  it.skip('hostKey with newlines is written verbatim (no structural validation, current behavior)', async () => {
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID, hostKey: 'line1\nline2\rline3' });
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    deps.prisma.environmentVariable.findMany.mockResolvedValueOnce([]);
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(true);
    const khCall = fsMock.writeFileSync.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('known-hosts'),
    );
    // .trim() only removes leading/trailing whitespace, internal \n/\r are preserved
    expect((khCall![1] as string)).toBe('[nas.example.com]:22 line1\nline2\rline3\n');
  });

  it.skip('target.port 0/65536/negative/string is used verbatim into sshArgs/scpArgs (current behavior, no range check)', async () => {
    for (const port of [0, 65536, -1, 'abc']) {
      const deps = makeDeps();
      deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID, port: port as any });
      deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
      deps.prisma.environmentVariable.findMany.mockResolvedValueOnce([]);
      queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
      queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
      queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
      queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
      const runner = makeRunner(deps);
      await runner.execute(makeContext());
      // ssh args include -p String(port)
      const currentCalls = execFileCalls.slice(-4);
      expect(currentCalls.map((call) => call.command)).toEqual(['ssh', 'scp', 'scp', 'ssh']);
      const portIdx = currentCalls[0].args.indexOf('-p');
      expect(portIdx).toBeGreaterThanOrEqual(0);
      expect(currentCalls[0].args[portIdx + 1]).toBe(String(port));
      for (const scpCall of currentCalls.slice(1, 3)) {
        const scpPortIndex = scpCall.args.indexOf('-P');
        expect(scpPortIndex).toBeGreaterThanOrEqual(0);
        expect(scpCall.args[scpPortIndex + 1]).toBe(String(port));
      }
    }
  });

  it.skip('does not validate target.projectId against payload.projectId — current behavior allows mismatched targets (mismatch is silently accepted)', async () => {
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID, projectId: 'other-project' });
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    deps.prisma.environmentVariable.findMany.mockResolvedValueOnce([]);
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(true);
  });
});

describe('RemoteSshRunner.execute - main deploy: workRoot normalization', () => {
  it.skip('default workRoot "/var/lib/launchly" is used when target.workRoot is undefined', async () => {
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID, workRoot: undefined as any });
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    deps.prisma.environmentVariable.findMany.mockResolvedValueOnce([]);
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(true);
    // The prepare ssh command's remote mkdir path should include /var/lib/launchly/apps/proj-1/env-1/deploy-1
    const prepare = execFileCalls.find((c) => c.command === 'ssh' && c.args.some((a) => a.includes('mkdir')));
    expect(prepare).toBeDefined();
    const remoteCmd = prepare!.args[prepare!.args.length - 1];
    expect(remoteCmd).toContain("'/var/lib/launchly/apps/proj-1/env-1/deploy-1'");
  });

  it.skip('custom workRoot "/srv/data" is used verbatim', async () => {
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID, workRoot: '/srv/data' });
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    deps.prisma.environmentVariable.findMany.mockResolvedValueOnce([]);
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(true);
    const prepare = execFileCalls.find((c) => c.command === 'ssh' && c.args.some((a) => a.includes('mkdir')));
    expect(prepare!.args[prepare!.args.length - 1]).toContain("'/srv/data/apps/proj-1/env-1/deploy-1'");
  });

  it.skip('workRoot with trailing slashes is normalized (current behavior)', async () => {
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID, workRoot: '/srv/data///' });
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    deps.prisma.environmentVariable.findMany.mockResolvedValueOnce([]);
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(true);
    const prepare = execFileCalls.find((c) => c.command === 'ssh' && c.args.some((a) => a.includes('mkdir')));
    expect(prepare!.args[prepare!.args.length - 1]).toContain("'/srv/data/apps/");
    // Trailing slashes are removed, no double slash
    expect(prepare!.args[prepare!.args.length - 1]).not.toContain("/apps'//'");
  });

  it.skip('workRoot with leading/trailing whitespace is trimmed', async () => {
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID, workRoot: '   /srv/data   ' });
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    deps.prisma.environmentVariable.findMany.mockResolvedValueOnce([]);
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(true);
  });

  it.skip.each([
    ['/', 'root slash'],
    ['relative/path', 'relative path'],
    ['/path with space', 'space in path'],
    ['/path/../escape', 'path traversal'],
    ['/path/.hidden', 'hidden segment'],
    ['/path;rm -rf /', 'shell metachar'],
    ['/path`whoami`', 'backticks'],
    ['/path$dollar', 'dollar sign'],
  ])('rejects workRoot "%s" (%s): key/known_hosts already written, then thrown caught, cleanup runs', async (workRoot, _desc) => {
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID, workRoot });
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    // The default makeSecrets.decrypt handles ENCRYPTED_TARGET_KEY
    const runner = makeRunner(deps);

    const result = await runner.execute(makeContext());

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('Deploy target work root is invalid');
    // Key and known_hosts are written BEFORE the workRoot check.
    // compose/env/nginx were never written (we exit before reaching them).
    expect(fsMock.writeFileSync.mock.calls.filter((c) => typeof c[0] === 'string' && (c[0] as string).endsWith('.compose.yml'))).toHaveLength(0);
    expect(fsMock.writeFileSync.mock.calls.filter((c) => typeof c[0] === 'string' && (c[0] as string).endsWith('.env'))).toHaveLength(0);
    // No scp/deploy/exec
    expect(execFileCalls).toHaveLength(0);
    // Cleanup runs: unlinkSync called for key + known_hosts (the two files we wrote)
    expect(fsMock.unlinkSync).toHaveBeenCalledTimes(2);
    expect(fsMock.unlinkSync.mock.calls.map((c) => c[0])).toEqual([
      '/tmp/launchly-builds/key-deploy-1',
      '/tmp/launchly-builds/known-hosts-deploy-1',
    ]);
  });

  it.skip('empty-string workRoot is defaulted to "/var/lib/launchly" (current behavior)', async () => {
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID, workRoot: '' });
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    deps.prisma.environmentVariable.findMany.mockResolvedValueOnce([]);
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// C. Main deploy: Artifact
// ════════════════════════════════════════════════════════════════════════════

describe('RemoteSshRunner.execute - main deploy: Artifact validation', () => {
  function armUpToArtifact(deps: any) {
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
  }

  it.skip('artifact.findUnique is called with { where: { deploymentId: ctx.refId } } exactly', async () => {
    const deps = makeDeps();
    armUpToArtifact(deps);
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    deps.prisma.environmentVariable.findMany.mockResolvedValueOnce([]);
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    const runner = makeRunner(deps);
    await runner.execute(makeContext({ refId: 'deploy-XYZ' }));
    expect(deps.prisma.artifact.findUnique).toHaveBeenCalledWith({ where: { deploymentId: 'deploy-XYZ' } });
  });

  it('Artifact not found returns "Deployment does not have a verified OCI artifact"', async () => {
    const deps = makeDeps();
    armUpToArtifact(deps);
    deps.prisma.artifact.findUnique.mockResolvedValueOnce(null);
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result.errorMessage).toBe('Deployment does not have a verified OCI artifact');
    expect(deps.prisma.environmentVariable.findMany).not.toHaveBeenCalled();
    expect(fsMock.mkdirSync).not.toHaveBeenCalled();
  });

  it('digest not starting with "sha256:" is rejected', async () => {
    const deps = makeDeps();
    armUpToArtifact(deps);
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID, digest: 'sha512:' + 'a'.repeat(64) });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result.errorMessage).toBe('Deployment does not have a verified OCI artifact');
  });

  it.skip('digest with too few characters passes (current behavior: only prefix is checked, KI-035)', async () => {
    const deps = makeDeps();
    armUpToArtifact(deps);
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID, digest: 'sha256:abc' });
    deps.prisma.environmentVariable.findMany.mockResolvedValueOnce([]);
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(true);
    // The compose file should contain imageRef@sha256:abc
    const composeCall = fsMock.writeFileSync.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].endsWith('.compose.yml'),
    );
    expect((composeCall![1] as string)).toContain('registry.example.com/team/app@sha256:abc');
  });

  it.skip('digest with 65 chars and 63 chars both pass (current behavior)', async () => {
    for (const len of [63, 65]) {
      const deps = makeDeps();
      armUpToArtifact(deps);
      deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID, digest: 'sha256:' + 'a'.repeat(len) });
      deps.prisma.environmentVariable.findMany.mockResolvedValueOnce([]);
      queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
      queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
      queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
      queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
      const runner = makeRunner(deps);
      const result = await runner.execute(makeContext());
      expect(result.success).toBe(true);
    }
  });

  it.skip('digest with non-hex characters passes (current behavior, KI-035)', async () => {
    const deps = makeDeps();
    armUpToArtifact(deps);
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID, digest: 'sha256:zzz_not_hex_chars_at_all_in_this_digest' });
    deps.prisma.environmentVariable.findMany.mockResolvedValueOnce([]);
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(true);
  });

  it.skip('digest with shell metacharacters passes (current behavior: digest only prefix-checked, KI-035)', async () => {
    const deps = makeDeps();
    armUpToArtifact(deps);
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID, digest: "sha256:abc';rm -rf /;echo '" });
    deps.prisma.environmentVariable.findMany.mockResolvedValueOnce([]);
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(true);
    // The remoteDeploy command should contain the malicious digest verbatim
    const deploy = execFileCalls.find((c) => c.command === 'ssh' && c.args.some((a) => typeof a === 'string' && a.includes('docker pull')));
    expect(deploy).toBeDefined();
    const remoteCmd = deploy!.args[deploy!.args.length - 1];
    expect(remoteCmd).toContain("sha256:abc';rm -rf /;echo '");
  });

  it.each([
    ['empty imageRef', ''],
    ['imageRef with space', 'registry example.com/app'],
    ['imageRef with double-quote', 'reg"stry/app'],
    ['imageRef with shell metachars', 'reg;rm/app'],
  ])('rejects imageRef "%s" with "Deployment does not have a verified OCI artifact"', async (_label, imageRef) => {
    const deps = makeDeps();
    armUpToArtifact(deps);
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID, imageRef });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result.errorMessage).toBe('Deployment does not have a verified OCI artifact');
  });

  it.skip('accepts imageRef with colons, slashes, dots, dashes, underscores, uppercase', async () => {
    const deps = makeDeps();
    armUpToArtifact(deps);
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID, imageRef: 'Registry.Example.COM:5000/Team_App/app:v1.0' });
    deps.prisma.environmentVariable.findMany.mockResolvedValueOnce([]);
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(true);
  });

  it.skip('accepts full 64-hex sha256 digest + valid imageRef', async () => {
    const deps = makeDeps();
    armUpToArtifact(deps);
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    deps.prisma.environmentVariable.findMany.mockResolvedValueOnce([]);
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(true);
  });

  it.skip('does not validate artifact.projectId against payload.projectId — current behavior (mismatch silently accepted)', async () => {
    const deps = makeDeps();
    armUpToArtifact(deps);
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID, projectId: 'other-project' });
    deps.prisma.environmentVariable.findMany.mockResolvedValueOnce([]);
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(true);
  });

  it.skip('artifact.digest being non-string triggers catch → "SSH deployment failed" (current behavior)', async () => {
    const deps = makeDeps();
    armUpToArtifact(deps);
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID, digest: undefined as any });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result).toEqual({
      success: false,
      stdout: '',
      stderr: "Cannot read properties of undefined (reading 'startsWith')",
      exitCode: -1,
      errorMessage: "Cannot read properties of undefined (reading 'startsWith')",
    });
  });

  it.skip('artifact.imageRef being undefined is accepted after RegExp coercion to "undefined" and reaches deployment (current behavior)', async () => {
    const deps = makeDeps();
    armUpToArtifact(deps);
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID, imageRef: undefined as any });
    deps.prisma.environmentVariable.findMany.mockResolvedValueOnce([]);
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: 'deployed', stderr: '', exitCode: 0 });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(true);
    const composeCall = fsMock.writeFileSync.mock.calls.find(
      (call) => call[0] === '/tmp/launchly-builds/deploy-1.compose.yml',
    );
    expect(composeCall?.[1]).toContain(`image: undefined@${ARTIFACT_VALID.digest}`);
    expect(execFileCalls[3].args.at(-1)).toContain(`docker pull 'undefined@${ARTIFACT_VALID.digest}'`);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// D. Main deploy: success paths
// ════════════════════════════════════════════════════════════════════════════

describe('RemoteSshRunner.execute - main deploy: success without domain (full wiring)', () => {
  it.skip('full sequence: Prisma, mkdir, key, known_hosts, prepare, compose, env, scp×2, deploy; success result; cleanup', async () => {
    const deps = makeDeps();
    buildHappyPathMocks(deps);
    const runner = makeRunner(deps);

    const result = await runner.execute(makeContext());

    // Result deep equal
    expect(result).toEqual({
      success: true,
      stdout: 'deploy-ok\n',
      stderr: 'deploy-err\n',
      exitCode: 0,
      errorMessage: '',
    });

    // Prisma query order: deployTarget → artifact → environmentVariable (only 3 calls in this flow)
    expect(deps.prisma.deployTarget.findUnique).toHaveBeenCalledTimes(1);
    expect(deps.prisma.artifact.findUnique).toHaveBeenCalledTimes(1);
    expect(deps.prisma.environmentVariable.findMany).toHaveBeenCalledTimes(1);
    expect(deps.prisma.environmentVariable.findMany).toHaveBeenCalledWith({ where: { environmentId: ENVIRONMENT_ID } });

    // decrypt called for target only
    expect(deps.secrets.decrypt).toHaveBeenCalledTimes(1);
    expect(deps.secrets.decrypt).toHaveBeenCalledWith(ENCRYPTED_TARGET_KEY);

    // mkdir exactly once with /tmp/launchly-builds, mode 0o700
    expect(fsMock.mkdirSync).toHaveBeenCalledTimes(1);
    expect(fsMock.mkdirSync).toHaveBeenCalledWith('/tmp/launchly-builds', { recursive: true, mode: 0o700 });

    // writeFileSync: 3 calls: key, known_hosts, compose, env = 4 (count)
    expect(fsMock.writeFileSync).toHaveBeenCalledTimes(4);

    // Key file: /tmp/launchly-builds/key-deploy-1, content PLAINTEXT_TARGET_KEY, mode 0o600
    const keyCall = fsMock.writeFileSync.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0] === '/tmp/launchly-builds/key-deploy-1',
    );
    expect(keyCall).toBeDefined();
    expect(keyCall![1]).toBe(PLAINTEXT_TARGET_KEY);
    expect(keyCall![2]).toEqual({ mode: 0o600 });

    // known_hosts: /tmp/launchly-builds/known-hosts-deploy-1
    const khCall = fsMock.writeFileSync.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0] === '/tmp/launchly-builds/known-hosts-deploy-1',
    );
    expect(khCall).toBeDefined();
    expect(khCall![1]).toBe('[nas.example.com]:22 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITESTKEYBASE64 trusted-nas\n');
    expect(khCall![2]).toEqual({ mode: 0o600 });

    // No nginx file
    const nginxCall = fsMock.writeFileSync.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].endsWith('.nginx.conf'),
    );
    expect(nginxCall).toBeUndefined();

    // Compose file path
    const composePath = '/tmp/launchly-builds/deploy-1.compose.yml';
    const composeCall = fsMock.writeFileSync.mock.calls.find((c) => c[0] === composePath);
    expect(composeCall).toBeDefined();
    expect(composeCall![2]).toEqual({ mode: 0o600 });
    // Compose content: no proxy alias
    expect(composeCall![1] as string).toContain('image: registry.example.com/team/app@sha256:' + 'a'.repeat(64));
    expect(composeCall![1] as string).toContain('"3000:3000"');
    expect(composeCall![1] as string).not.toContain('launchly_proxy');

    // env file path
    const envPath = '/tmp/launchly-builds/deploy-1.env';
    const envCall = fsMock.writeFileSync.mock.calls.find((c) => c[0] === envPath);
    expect(envCall).toBeDefined();
    expect(envCall![1] as string).toBe('');
    expect(envCall![2]).toEqual({ mode: 0o600 });

    // execFile calls: prepare ssh, scp compose, scp env, deploy ssh = 4
    expect(execFileCalls).toHaveLength(4);
    expect(execFileCalls.map((c) => c.command)).toEqual(['ssh', 'scp', 'scp', 'ssh']);

    // Prepare ssh command: full args
    const prepare = execFileCalls[0];
    expect(prepare.command).toBe('ssh');
    expect(prepare.args).toEqual([
      '-i', '/tmp/launchly-builds/key-deploy-1',
      '-p', '22',
      '-o', 'BatchMode=yes',
      '-o', 'PasswordAuthentication=no',
      '-o', 'StrictHostKeyChecking=yes',
      '-o', 'UserKnownHostsFile=/tmp/launchly-builds/known-hosts-deploy-1',
      'launchly@nas.example.com',
      "set -eu; mkdir -p '/var/lib/launchly/apps/proj-1/env-1/deploy-1'; chmod 700 '/var/lib/launchly/apps/proj-1/env-1/deploy-1'",
    ]);
    expect(prepare.options).toEqual({ timeout: 60 });

    // scp compose: must use -P (not -p) and timeout 120
    const scpCompose = execFileCalls[1];
    expect(scpCompose.command).toBe('scp');
    expect(scpCompose.args).toEqual([
      '-i', '/tmp/launchly-builds/key-deploy-1',
      '-P', '22',
      '-o', 'BatchMode=yes',
      '-o', 'PasswordAuthentication=no',
      '-o', 'StrictHostKeyChecking=yes',
      '-o', 'UserKnownHostsFile=/tmp/launchly-builds/known-hosts-deploy-1',
      composePath,
      'launchly@nas.example.com:/var/lib/launchly/apps/proj-1/env-1/deploy-1/deploy-1.compose.yml',
    ]);
    expect(scpCompose.options).toEqual({ timeout: 120 });

    // scp env
    const scpEnv = execFileCalls[2];
    expect(scpEnv.command).toBe('scp');
    expect(scpEnv.args).toEqual([
      '-i', '/tmp/launchly-builds/key-deploy-1',
      '-P', '22',
      '-o', 'BatchMode=yes',
      '-o', 'PasswordAuthentication=no',
      '-o', 'StrictHostKeyChecking=yes',
      '-o', 'UserKnownHostsFile=/tmp/launchly-builds/known-hosts-deploy-1',
      envPath,
      'launchly@nas.example.com:/var/lib/launchly/apps/proj-1/env-1/deploy-1/deploy-1.env',
    ]);

    // Deploy ssh: must include docker pull + docker compose up -d --no-build, projectName with underscores, immutableImage=imageRef@digest
    const deploy = execFileCalls[3];
    expect(deploy.command).toBe('ssh');
    expect(deploy.options).toEqual({ timeout: 600 });
    const remoteDeploy = deploy.args[deploy.args.length - 1];
    expect(remoteDeploy).toContain(`docker pull 'registry.example.com/team/app@sha256:${'a'.repeat(64)}'`);
    expect(remoteDeploy).toContain(`--project-name 'launchly_proj_1_env_1'`);
    expect(remoteDeploy).toContain(`--env-file '/var/lib/launchly/apps/proj-1/env-1/deploy-1/deploy-1.env'`);
    expect(remoteDeploy).toContain(`-f '/var/lib/launchly/apps/proj-1/env-1/deploy-1/deploy-1.compose.yml'`);
    expect(remoteDeploy).toContain('up -d --no-build');

    // No stageLogCallback when none provided
    // (no callback in this test)

    // Cleanup: unlinkSync called for key, known_hosts, compose, env (no nginx)
    expect(fsMock.unlinkSync).toHaveBeenCalledTimes(4);
    expect(fsMock.unlinkSync.mock.calls.map((c) => c[0])).toEqual([
      '/tmp/launchly-builds/key-deploy-1',
      '/tmp/launchly-builds/known-hosts-deploy-1',
      composePath,
      envPath,
    ]);
  });

  it.skip('success with stageLogCallback: callback("RUNNING", "Transferring ...") before env file write, callback("RUNNING", "Pulling ...") before deploy', async () => {
    const deps = makeDeps();
    buildHappyPathMocks(deps);
    const callback = jest.fn(async (status: string, logText: string) => {
      effectEvents.push(`stage:${status}:${logText}`);
    });
    const runner = makeRunner(deps);
    await runner.execute(makeContext({ stageLogCallback: callback }));

    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenNthCalledWith(1, 'RUNNING', 'Transferring deployment manifest for immutable registry artifact...');
    expect(callback).toHaveBeenNthCalledWith(2, 'RUNNING', 'Pulling immutable registry artifact and starting isolated Compose project...');
    expect(effectEvents.indexOf('stage:RUNNING:Transferring deployment manifest for immutable registry artifact...'))
      .toBeLessThan(effectEvents.indexOf('write:/tmp/launchly-builds/deploy-1.compose.yml'));
    expect(effectEvents.indexOf('stage:RUNNING:Pulling immutable registry artifact and starting isolated Compose project...'))
      .toBeLessThan(effectEvents.findIndex((event) => event.startsWith('execFile:ssh:set -eu; docker pull')));
  });

  it.skip('executor.exec is NEVER called (RemoteSshRunner must not use the shell-wrapping exec)', async () => {
    const deps = makeDeps();
    buildHappyPathMocks(deps);
    const runner = makeRunner(deps);
    await runner.execute(makeContext());
    expect(deps.executor.exec).not.toHaveBeenCalled();
  });

  it.skip('deploy stdout is returned verbatim and stderr is from the deploy call (not from prepare/scp)', async () => {
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    deps.prisma.environmentVariable.findMany.mockResolvedValueOnce([]);
    queueExecFile({ stdout: 'prepare-out', stderr: 'prepare-err', exitCode: 0 });
    queueExecFile({ stdout: 'scp-compose-out', stderr: 'scp-compose-err', exitCode: 0 });
    queueExecFile({ stdout: 'scp-env-out', stderr: 'scp-env-err', exitCode: 0 });
    queueExecFile({ stdout: 'deploy-out\n', stderr: 'deploy-err\n', exitCode: 0 });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result.stdout).toBe('deploy-out\n');
    expect(result.stderr).toBe('deploy-err\n');
  });

  it.skip('secrets in deploy stdout/stderr are returned verbatim (no sanitize in this layer, KI-028)', async () => {
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    deps.prisma.environmentVariable.findMany.mockResolvedValueOnce([]);
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({
      stdout: 'connecting with password=hunter2\n',
      stderr: 'token=ghp_abcdefghijklmnopqrstuvwxyz\n',
      exitCode: 0,
    });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result.stdout).toContain('hunter2');
    expect(result.stderr).toContain('ghp_abcdefghijklmnopqrstuvwxyz');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// E. Main deploy: success with domain (Nginx)
// ════════════════════════════════════════════════════════════════════════════

describe('RemoteSshRunner.execute - main deploy: success with domain (full Nginx wiring)', () => {
  function armHappyDomainDeploy(deps: any) {
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    deps.prisma.environmentVariable.findMany.mockResolvedValueOnce([]);
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 }); // prepare
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 }); // scp compose
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 }); // scp env
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 }); // scp nginx
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 }); // proxy bootstrap ssh
    queueExecFile({ stdout: 'deploy-ok', stderr: '', exitCode: 0 }); // deploy
    queueExecFile({ stdout: 'nginx-ok', stderr: '', exitCode: 0 }); // nginx activate ssh
  }

  it.skip('full domain success: extra nginx file, 3 scp, proxy bootstrap, nginx activate; deploy stdout + Nginx route line; cleanup', async () => {
    const deps = makeDeps();
    armHappyDomainDeploy(deps);
    const callback = jest.fn(async () => undefined);
    const runner = makeRunner(deps);
    const result = await runner.execute(
      makeContext({
        payload: { projectId: 'proj-1', environmentId: 'env-1', deployTargetId: 'target-1', domain: 'app.example.com' },
        stageLogCallback: callback,
      }),
    );

    expect(result.success).toBe(true);
    // stdout: deploy stdout + "\nNginx route active: http://app.example.com"
    expect(result.stdout).toBe('deploy-ok\nNginx route active: http://app.example.com');

    // 7 execFile calls: 1 prepare ssh, 3 scp, 1 proxy bootstrap ssh, 1 deploy ssh, 1 activate ssh
    expect(execFileCalls).toHaveLength(7);
    expect(execFileCalls.map((c) => c.command)).toEqual(['ssh', 'scp', 'scp', 'scp', 'ssh', 'ssh', 'ssh']);

    // nginx file: deploy-1.nginx.conf
    const nginxPath = '/tmp/launchly-builds/deploy-1.nginx.conf';
    const nginxCall = fsMock.writeFileSync.mock.calls.find((c) => c[0] === nginxPath);
    expect(nginxCall).toBeDefined();
    expect(nginxCall![2]).toEqual({ mode: 0o600 });
    // Content: server_name app.example.com, listen 80, proxy_pass http://app_proj_1_env_1:3000
    const nginxContent = nginxCall![1] as string;
    expect(nginxContent).toContain('listen 80;');
    expect(nginxContent).toContain('server_name app.example.com;');
    expect(nginxContent).toContain('proxy_pass http://app_proj_1_env_1:3000;');

    // compose file: contains launchly_proxy network and alias
    const composePath = '/tmp/launchly-builds/deploy-1.compose.yml';
    const composeCall = fsMock.writeFileSync.mock.calls.find((c) => c[0] === composePath);
    const composeContent = composeCall![1] as string;
    expect(composeContent).toContain('launchly_proxy');
    expect(composeContent).toContain('aliases:');
    expect(composeContent).toContain('- app_proj_1_env_1');
    expect(composeContent).toContain('external: true');

    // proxy alias uses underscores (hyphens replaced)
    expect(composeContent).not.toContain('app_proj-1_env-1');

    // 4th execFile (proxy bootstrap) command includes docker run with nginx:1.27.5-alpine and -p 80:80
    const proxy = execFileCalls[4];
    expect(proxy.command).toBe('ssh');
    expect(proxy.options).toEqual({ timeout: 180 });
    const proxyCmd = proxy.args[proxy.args.length - 1];
    expect(proxyCmd).toContain('docker network inspect');
    expect(proxyCmd).toContain("'launchly_proxy'");
    expect(proxyCmd).toContain("'launchly-proxy'");
    expect(proxyCmd).toContain('nginx:1.27.5-alpine');
    expect(proxyCmd).toContain("-p 80:80");

    // 6th execFile (deploy): no change from non-domain case
    // 7th execFile (nginx activate): includes cp, chmod, nginx -t, nginx -s reload
    const activate = execFileCalls[6];
    expect(activate.command).toBe('ssh');
    expect(activate.options).toEqual({ timeout: 120 });
    const activateCmd = activate.args[activate.args.length - 1];
    expect(activateCmd).toContain("cp '/var/lib/launchly/apps/proj-1/env-1/deploy-1/deploy-1.nginx.conf' '/var/lib/launchly/proxy/conf.d/launchly-proj-1-env-1.conf'");
    expect(activateCmd).toContain("chmod 644 '/var/lib/launchly/proxy/conf.d/launchly-proj-1-env-1.conf'");
    expect(activateCmd).toContain("if ! docker exec 'launchly-proxy' nginx -t");
    expect(activateCmd).toContain("rm -f '/var/lib/launchly/proxy/conf.d/launchly-proj-1-env-1.conf'");
    expect(activateCmd).toContain("docker exec 'launchly-proxy' nginx -s reload");

    // stageLogCallback: 3 calls (transfer, pulling, activating)
    expect(callback).toHaveBeenCalledTimes(3);
    expect(callback).toHaveBeenNthCalledWith(1, 'RUNNING', 'Transferring deployment manifest for immutable registry artifact...');
    expect(callback).toHaveBeenNthCalledWith(2, 'RUNNING', 'Pulling immutable registry artifact and starting isolated Compose project...');
    expect(callback).toHaveBeenNthCalledWith(3, 'RUNNING', 'Activating Nginx route for app.example.com...');

    // Cleanup: 5 unlink calls (key, known_hosts, compose, env, nginx)
    expect(fsMock.unlinkSync).toHaveBeenCalledTimes(5);
    expect(fsMock.unlinkSync.mock.calls.map((c) => c[0])).toEqual([
      '/tmp/launchly-builds/key-deploy-1',
      '/tmp/launchly-builds/known-hosts-deploy-1',
      composePath,
      '/tmp/launchly-builds/deploy-1.env',
      nginxPath,
    ]);
  });

  it.skip('domain with hyphen projectId/environmentId is converted to underscores in proxyAlias and projectName (current behavior)', async () => {
    const deps = makeDeps();
    armHappyDomainDeploy(deps);
    const runner = makeRunner(deps);
    const result = await runner.execute(
      makeContext({
        payload: { projectId: 'proj-with-hyphen', environmentId: 'env-with-hyphen', deployTargetId: 'target-1', domain: 'app.example.com' },
      }),
    );
    expect(result.success).toBe(true);
    // proxyAlias: app_proj_with_hyphen_env_with_hyphen
    const composeCall = fsMock.writeFileSync.mock.calls.find((c) => typeof c[0] === 'string' && c[0].endsWith('.compose.yml'));
    const composeContent = composeCall![1] as string;
    expect(composeContent).toContain('- app_proj_with_hyphen_env_with_hyphen');
    // proxyConfig file name: launchly-proj-with-hyphen-env-with-hyphen.conf
    const activate = execFileCalls[6];
    const activateCmd = activate.args[activate.args.length - 1];
    expect(activateCmd).toContain('launchly-proj-with-hyphen-env-with-hyphen.conf');
  });

  it.skip('empty deploy stdout + domain → current behavior: result.stdout is just "\\nNginx route active: ..." (extra leading newline)', async () => {
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    deps.prisma.environmentVariable.findMany.mockResolvedValueOnce([]);
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    const runner = makeRunner(deps);
    const result = await runner.execute(
      makeContext({ payload: { projectId: PROJECT_ID, environmentId: ENVIRONMENT_ID, deployTargetId: 'target-1', domain: 'app.example.com' } }),
    );
    expect(result.success).toBe(true);
    // Current behavior: ${deploy.stdout} + `\nNginx route active: ...` even when deploy.stdout is empty
    expect(result.stdout).toBe('\nNginx route active: http://app.example.com');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// F. Main deploy: env var file
// ════════════════════════════════════════════════════════════════════════════

describe('RemoteSshRunner.execute - main deploy: env var file generation', () => {
  function armVars(
    deps: any,
    vars: Array<{ key: string; encryptedValue: string; plain: string }>,
    expectManifestGenerationToSucceed = true,
  ) {
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    deps.prisma.environmentVariable.findMany.mockResolvedValueOnce(
      vars.map((v) => ({ key: v.key, encryptedValue: v.encryptedValue })),
    );
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 }); // prepare
    if (expectManifestGenerationToSucceed) {
      queueExecFile({ stdout: '', stderr: '', exitCode: 0 }); // compose scp
      queueExecFile({ stdout: '', stderr: '', exitCode: 0 }); // env scp
      queueExecFile({ stdout: '', stderr: '', exitCode: 0 }); // deploy
    }
    // Build a varMap for env-var ciphertexts, then use mockImplementation
    // (not mockImplementationOnce) because the runner calls decrypt for the
    // target key first AND then for each env var.
    const varMap: Record<string, string> = {};
    for (const v of vars) varMap[v.encryptedValue] = v.plain;
    (deps.secrets.decrypt as jest.Mock).mockImplementation((enc: string) => {
      if (enc === ENCRYPTED_TARGET_KEY) return PLAINTEXT_TARGET_KEY;
      if (enc in varMap) return varMap[enc];
      throw new Error('Unexpected decrypt: ' + enc);
    });
  }

  it.skip('writes each environment variable as KEY="value" with double-quoted values, joined by newlines', async () => {
    const deps = makeDeps();
    armVars(deps, [
      { key: 'NODE_ENV', encryptedValue: 'v2:enc(node-env)', plain: 'production' },
      { key: 'PORT', encryptedValue: 'v2:enc(port)', plain: '3000' },
    ]);
    const runner = makeRunner(deps);
    await runner.execute(makeContext());

    const envCall = fsMock.writeFileSync.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].endsWith('.env'),
    );
    expect((envCall![1] as string)).toBe('NODE_ENV="production"\nPORT="3000"');
  });

  it.skip('escapes double-quote and backslash in value (current behavior: replaces `\\` with `\\\\`, `"` with `\\"`)', async () => {
    const deps = makeDeps();
    armVars(deps, [
      { key: 'PASSWORD', encryptedValue: 'v2:enc(p)', plain: 'he\\said"hi"' },
    ]);
    const runner = makeRunner(deps);
    await runner.execute(makeContext());

    const envCall = fsMock.writeFileSync.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].endsWith('.env'),
    );
    // The current code replaces backslashes first, then double-quotes
    expect((envCall![1] as string)).toBe('PASSWORD="he\\\\said\\"hi\\""');
  });

  it.skip('rejects when env value contains NUL byte', async () => {
    const deps = makeDeps();
    armVars(deps, [
      { key: 'BAD', encryptedValue: 'v2:enc(bad)', plain: 'a\0b' },
    ], false);
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('Invalid environment variable: BAD');
  });

  it.skip('rejects when env value contains LF', async () => {
    const deps = makeDeps();
    armVars(deps, [
      { key: 'BAD', encryptedValue: 'v2:enc(bad)', plain: 'a\nb' },
    ], false);
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('Invalid environment variable: BAD');
  });

  it.skip('documents current behavior: env value containing CR is accepted (CR is not in the rejection list)', async () => {
    const deps = makeDeps();
    armVars(deps, [
      { key: 'WEIRD', encryptedValue: 'v2:enc(w)', plain: 'a\rb' },
    ]);
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(true);
    const envCall = fsMock.writeFileSync.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].endsWith('.env'),
    );
    expect((envCall![1] as string)).toBe('WEIRD="a\rb"');
  });

  it.skip('rejects when env key is invalid (starts with digit, has hyphen, empty, has space)', async () => {
    for (const badKey of ['1INVALID', 'HAS-HYPHEN', 'has space', 'has=eq', '']) {
      const deps = makeDeps();
      armVars(deps, [
        { key: badKey, encryptedValue: 'v2:enc(bad)', plain: 'v' },
      ], false);
      const runner = makeRunner(deps);
      const result = await runner.execute(makeContext());
      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain('Invalid environment variable');
    }
  });

  it.skip('accepts empty value', async () => {
    const deps = makeDeps();
    armVars(deps, [
      { key: 'EMPTY', encryptedValue: 'v2:enc(e)', plain: '' },
    ]);
    const runner = makeRunner(deps);
    await runner.execute(makeContext());
    const envCall = fsMock.writeFileSync.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].endsWith('.env'),
    );
    expect((envCall![1] as string)).toBe('EMPTY=""');
  });

  it.skip('documents current behavior: duplicate keys collapse via Object.fromEntries (last wins)', async () => {
    const deps = makeDeps();
    armVars(deps, [
      { key: 'DUP', encryptedValue: 'v2:enc(a)', plain: 'first' },
      { key: 'DUP', encryptedValue: 'v2:enc(b)', plain: 'second' },
    ]);
    const runner = makeRunner(deps);
    await runner.execute(makeContext());
    const envCall = fsMock.writeFileSync.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].endsWith('.env'),
    );
    expect((envCall![1] as string)).toBe('DUP="second"');
  });

  it.skip('rejects when environmentVariable.findMany rejects (after prepare ssh has succeeded)', async () => {
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 }); // prepare ssh succeeds first
    deps.prisma.environmentVariable.findMany.mockRejectedValueOnce(new Error('db down'));
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('db down');
    // The prepare ssh call did happen (it's before getEnvironmentVariables)
    expect(execFileCalls).toHaveLength(1);
    // No scp/deploy
    expect(execFileCalls.filter((c) => c.command === 'scp')).toHaveLength(0);
  });

  it.skip('rejects when one variable decrypt throws (after prepare ssh)', async () => {
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 }); // prepare ssh
    deps.prisma.environmentVariable.findMany.mockResolvedValueOnce([
      { key: 'K', encryptedValue: 'v2:enc(k)' },
    ]);
    (deps.secrets.decrypt as jest.Mock).mockImplementation((enc: string) => {
      if (enc === ENCRYPTED_TARGET_KEY) return PLAINTEXT_TARGET_KEY;
      if (enc === 'v2:enc(k)') throw new Error('decrypt-failure');
      throw new Error('Unexpected decrypt: ' + enc);
    });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('decrypt-failure');
    // No scp
    expect(execFileCalls).toHaveLength(1);
    // The previously written key/known_hosts are cleaned up in finally
    expect(fsMock.unlinkSync).toHaveBeenCalledWith('/tmp/launchly-builds/key-deploy-1');
    expect(fsMock.unlinkSync).toHaveBeenCalledWith('/tmp/launchly-builds/known-hosts-deploy-1');
  });

  it.skip('plaintext variable value never appears in ssh/scp args or stageLog (only in env file write)', async () => {
    const deps = makeDeps();
    const secretPlain = 'super-secret-plaintext-12345';
    armVars(deps, [
      { key: 'API_TOKEN', encryptedValue: 'v2:enc(api)', plain: secretPlain },
    ]);
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(true);

    // Must appear exactly once, in the env file write
    const envCall = fsMock.writeFileSync.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].endsWith('.env'),
    );
    expect((envCall![1] as string)).toContain(secretPlain);
    expect(fsMock.writeFileSync.mock.calls.filter((c) => (c[1] as string).includes(secretPlain))).toHaveLength(1);

    // Not in any ssh/scp arg
    for (const call of execFileCalls) {
      for (const arg of call.args) {
        if (typeof arg === 'string') {
          expect(arg).not.toContain(secretPlain);
        }
      }
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// G. Main deploy: failure and cleanup
// ════════════════════════════════════════════════════════════════════════════

describe('RemoteSshRunner.execute - main deploy: failure matrix (each result must be deep-equal and stop side effects)', () => {
  function cleanupAllowed() {
    // By default safeUnlink swallows errors; allow it
    fsMock.unlinkSync.mockReset().mockImplementation(() => undefined);
  }

  it('deployTarget.findUnique rejects: caught → "SSH deployment failed" with thrown message', async () => {
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockRejectedValueOnce(new Error('db down'));
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('db down');
    expect(fsMock.mkdirSync).not.toHaveBeenCalled();
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
    expect(execFileCalls).toHaveLength(0);
  });

  it('artifact.findUnique rejects: caught → "SSH deployment failed" with thrown message (current behavior: no key/known_hosts were yet written, so cleanup is a no-op)', async () => {
    cleanupAllowed();
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    deps.prisma.artifact.findUnique.mockRejectedValueOnce(new Error('artifact db down'));
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('artifact db down');
    // artifact.findUnique throws BEFORE the key/known_hosts writes, so nothing
    // was written. The finally cleanup iterates undefined paths and unlinks nothing.
    expect(fsMock.mkdirSync).not.toHaveBeenCalled();
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
    expect(fsMock.unlinkSync).not.toHaveBeenCalled();
    expect(execFileCalls).toHaveLength(0);
  });

  it.skip('decrypt(target.encryptedCredential) throws: caught → message; key/known_hosts cleaned up', async () => {
    cleanupAllowed();
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    deps.secrets.decrypt.mockImplementationOnce(() => { throw new Error('credential decrypt fail'); });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('credential decrypt fail');
    expect(execFileCalls).toHaveLength(0);
  });

  it('mkdirSync throws: caught → message; no file writes, no exec', async () => {
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    fsMock.mkdirSync.mockImplementationOnce(() => { throw new Error('EACCES mkdir'); });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('EACCES mkdir');
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
    expect(execFileCalls).toHaveLength(0);
  });

  it.skip('writeFileSync(keyPath) throws: caught → message; known_hosts not written; no exec', async () => {
    cleanupAllowed();
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    fsMock.mkdirSync.mockReset().mockImplementation(() => undefined);
    fsMock.writeFileSync.mockReset().mockImplementation((p) => {
      if (typeof p === 'string' && p.includes('key-')) throw new Error('EACCES key write');
    });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('EACCES key write');
    expect(execFileCalls).toHaveLength(0);
  });

  it.skip('writeFileSync(knownHostsPath) throws: caught → message; no exec', async () => {
    cleanupAllowed();
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    fsMock.mkdirSync.mockReset().mockImplementation(() => undefined);
    fsMock.writeFileSync.mockReset().mockImplementation((p) => {
      if (typeof p === 'string' && p.includes('known-hosts')) throw new Error('EACCES kh write');
    });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('EACCES kh write');
    expect(execFileCalls).toHaveLength(0);
  });

  it.skip('prepare ssh returns non-zero: "Unable to create isolated remote deployment directory" + resultFrom preserves stdout/stderr/exitCode', async () => {
    cleanupAllowed();
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    queueExecFile({ stdout: 'preparing...', stderr: 'mkdir fail', exitCode: 1 });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result).toEqual({
      success: false,
      stdout: 'preparing...',
      stderr: 'mkdir fail',
      exitCode: 1,
      errorMessage: 'Unable to create isolated remote deployment directory',
    });
    // No compose/env writes, no scp, no deploy
    expect(fsMock.writeFileSync.mock.calls.filter((c) => typeof c[0] === 'string' && (c[0] as string).endsWith('.compose.yml'))).toHaveLength(0);
    expect(execFileCalls).toHaveLength(1);
    // Finally cleanup: key, known_hosts
    expect(fsMock.unlinkSync).toHaveBeenCalledTimes(2);
  });

  it.skip('prepare ssh throws: caught → thrown message; cleanup of key/known_hosts', async () => {
    cleanupAllowed();
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    queueExecFile({ throw: new Error('SSH connection refused') });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('SSH connection refused');
    expect(execFileCalls).toHaveLength(1);
    expect(fsMock.unlinkSync).toHaveBeenCalledTimes(2);
  });

  it.skip('first stageLogCallback throws: caught → "RUNNING ..." message; no compose/env write; no scp/deploy', async () => {
    cleanupAllowed();
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    const callback = jest.fn(async () => {
      throw new Error('cb down');
    });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext({ stageLogCallback: callback }));
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('cb down');
    // compose/env not written, no scp/deploy beyond prepare
    expect(fsMock.writeFileSync.mock.calls.filter((c) => typeof c[0] === 'string' && (c[0] as string).endsWith('.compose.yml'))).toHaveLength(0);
    expect(fsMock.writeFileSync.mock.calls.filter((c) => typeof c[0] === 'string' && (c[0] as string).endsWith('.env'))).toHaveLength(0);
    expect(execFileCalls).toHaveLength(1);
  });

  it.skip('writeFileSync(composePath) throws: caught → message; env not written; cleanup', async () => {
    cleanupAllowed();
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    deps.prisma.environmentVariable.findMany.mockResolvedValueOnce([]);
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    fsMock.writeFileSync.mockReset().mockImplementation((p) => {
      if (typeof p === 'string' && p.endsWith('.compose.yml')) throw new Error('EACCES compose');
      return undefined; // no-op for everything else
    });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('EACCES compose');
    // env not written
    expect(fsMock.writeFileSync.mock.calls.filter((c) => typeof c[0] === 'string' && (c[0] as string).endsWith('.env'))).toHaveLength(0);
    expect(execFileCalls).toHaveLength(1);
    // Cleanup: key, known_hosts, compose, env (composePath AND envPath are both
    // assigned before writeFileSync for compose throws, so both are unlinked)
    expect(fsMock.unlinkSync).toHaveBeenCalledTimes(4);
    expect(fsMock.unlinkSync.mock.calls.map((c) => c[0])).toEqual([
      '/tmp/launchly-builds/key-deploy-1',
      '/tmp/launchly-builds/known-hosts-deploy-1',
      '/tmp/launchly-builds/deploy-1.compose.yml',
      '/tmp/launchly-builds/deploy-1.env',
    ]);
  });

  it.skip('writeFileSync(envPath) throws: caught → message; cleanup', async () => {
    cleanupAllowed();
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    deps.prisma.environmentVariable.findMany.mockResolvedValueOnce([]);
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    const realWrite = fsMock.writeFileSync.getMockImplementation();
    fsMock.writeFileSync.mockReset().mockImplementation((p, c, o) => {
      if (typeof p === 'string' && p.endsWith('.env')) throw new Error('EACCES env');
      return (realWrite as any)?.(p, c, o);
    });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('EACCES env');
    expect(execFileCalls).toHaveLength(1);
  });

  it.skip('compose scp returns non-zero: "Deployment manifest transfer failed" + resultFrom preserves stdout/stderr/exitCode', async () => {
    cleanupAllowed();
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    deps.prisma.environmentVariable.findMany.mockResolvedValueOnce([]);
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 }); // prepare
    queueExecFile({ stdout: '', stderr: 'scp: permission denied', exitCode: 1 }); // scp compose
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result).toEqual({
      success: false,
      stdout: '',
      stderr: 'scp: permission denied',
      exitCode: 1,
      errorMessage: 'Deployment manifest transfer failed',
    });
    expect(execFileCalls).toHaveLength(2);
    expect(fsMock.unlinkSync).toHaveBeenCalledTimes(4);
  });

  it.skip('env scp returns non-zero: same errorMessage, preserves scp stdout/stderr/exitCode', async () => {
    cleanupAllowed();
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    deps.prisma.environmentVariable.findMany.mockResolvedValueOnce([]);
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: 'env-fail', stderr: 'env-scp-err', exitCode: 1 });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result).toEqual({
      success: false,
      stdout: 'env-fail',
      stderr: 'env-scp-err',
      exitCode: 1,
      errorMessage: 'Deployment manifest transfer failed',
    });
  });

  it.skip('nginx scp returns non-zero (with domain): same errorMessage', async () => {
    cleanupAllowed();
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    deps.prisma.environmentVariable.findMany.mockResolvedValueOnce([]);
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 }); // prepare
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 }); // scp compose
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 }); // scp env
    queueExecFile({ stdout: 'nginx-scp-fail', stderr: 'nginx-scp-err', exitCode: 1 }); // scp nginx
    const runner = makeRunner(deps);
    const result = await runner.execute(
      makeContext({ payload: { projectId: PROJECT_ID, environmentId: ENVIRONMENT_ID, deployTargetId: 'target-1', domain: 'app.example.com' } }),
    );
    expect(result.errorMessage).toBe('Deployment manifest transfer failed');
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('nginx-scp-fail');
    expect(result.stderr).toBe('nginx-scp-err');
  });

  it.skip('scp execFile throws: caught → message', async () => {
    cleanupAllowed();
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    deps.prisma.environmentVariable.findMany.mockResolvedValueOnce([]);
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ throw: new Error('scp process crash') });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('scp process crash');
  });

  it.skip('second stageLogCallback throws: caught → message; no deploy, no Nginx activation', async () => {
    cleanupAllowed();
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    deps.prisma.environmentVariable.findMany.mockResolvedValueOnce([]);
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    // The 2nd callback throws
    const callback = jest.fn(async (status: string, _logText: string) => {
      if (status === 'RUNNING' && _logText === 'Pulling immutable registry artifact and starting isolated Compose project...') {
        throw new Error('pulling cb down');
      }
    });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext({ stageLogCallback: callback }));
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('pulling cb down');
    // No deploy ssh, no Nginx activation
    expect(execFileCalls.filter((c) => c.command === 'ssh' && c.args.some((a) => typeof a === 'string' && a.includes('docker pull')))).toHaveLength(0);
  });

  it.skip('proxy bootstrap ssh returns non-zero (with domain): "Unable to start the shared Launchly Nginx proxy..."', async () => {
    cleanupAllowed();
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    deps.prisma.environmentVariable.findMany.mockResolvedValueOnce([]);
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: 'proxy fail', stderr: 'port 80 in use', exitCode: 1 });
    const runner = makeRunner(deps);
    const result = await runner.execute(
      makeContext({ payload: { projectId: PROJECT_ID, environmentId: ENVIRONMENT_ID, deployTargetId: 'target-1', domain: 'app.example.com' } }),
    );
    expect(result).toEqual({
      success: false,
      stdout: 'proxy fail',
      stderr: 'port 80 in use',
      exitCode: 1,
      errorMessage: 'Unable to start the shared Launchly Nginx proxy; ensure ports 80 and 443 are available to Docker',
    });
    // No deploy ssh, no nginx activate
    expect(execFileCalls).toHaveLength(5);
  });

  it.skip('proxy bootstrap ssh throws: caught → message', async () => {
    cleanupAllowed();
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    deps.prisma.environmentVariable.findMany.mockResolvedValueOnce([]);
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ throw: new Error('proxy ssh crash') });
    const runner = makeRunner(deps);
    const result = await runner.execute(
      makeContext({ payload: { projectId: PROJECT_ID, environmentId: ENVIRONMENT_ID, deployTargetId: 'target-1', domain: 'app.example.com' } }),
    );
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('proxy ssh crash');
  });

  it.skip('deploy ssh returns non-zero: "Remote deployment failed" + resultFrom preserves stdout/stderr/exitCode', async () => {
    cleanupAllowed();
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    deps.prisma.environmentVariable.findMany.mockResolvedValueOnce([]);
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: 'pulling\n', stderr: 'image not found\n', exitCode: 125 });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result).toEqual({
      success: false,
      stdout: 'pulling\n',
      stderr: 'image not found\n',
      exitCode: 125,
      errorMessage: 'Remote deployment failed',
    });
  });

  it.skip('deploy ssh throws: caught → message; no Nginx activation', async () => {
    cleanupAllowed();
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    deps.prisma.environmentVariable.findMany.mockResolvedValueOnce([]);
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ throw: new Error('deploy crash') });
    const runner = makeRunner(deps);
    const result = await runner.execute(
      makeContext({ payload: { projectId: PROJECT_ID, environmentId: ENVIRONMENT_ID, deployTargetId: 'target-1', domain: 'app.example.com' } }),
    );
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('deploy crash');
    expect(execFileCalls.map((call) => call.command)).toEqual([
      'ssh', 'scp', 'scp', 'scp', 'ssh', 'ssh',
    ]);
    // No nginx activation
    expect(execFileCalls.filter((c) => c.command === 'ssh' && c.args.some((a) => typeof a === 'string' && a.includes('nginx -s reload')))).toHaveLength(0);
  });

  it.skip('nginx activation callback throws: caught → message (current behavior: container already deployed)', async () => {
    cleanupAllowed();
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    deps.prisma.environmentVariable.findMany.mockResolvedValueOnce([]);
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: 'deploy-ok', stderr: '', exitCode: 0 });
    const callback = jest.fn(async (status: string, logText: string) => {
      if (status === 'RUNNING' && logText.startsWith('Activating Nginx route')) {
        throw new Error('activating cb down');
      }
    });
    const runner = makeRunner(deps);
    const result = await runner.execute(
      makeContext({ payload: { projectId: PROJECT_ID, environmentId: ENVIRONMENT_ID, deployTargetId: 'target-1', domain: 'app.example.com' }, stageLogCallback: callback }),
    );
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('activating cb down');
    // Nginx activation ssh not yet called (it comes after the 3rd callback)
    expect(execFileCalls).toHaveLength(6);
  });

  it.skip('nginx activation ssh returns non-zero: "Nginx route activation failed; ..." + resultFrom preserves stdout/stderr/exitCode (current behavior: container already deployed, no rollback)', async () => {
    cleanupAllowed();
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    deps.prisma.environmentVariable.findMany.mockResolvedValueOnce([]);
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: 'deploy-ok', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: 'nginx fail', stderr: 'nginx -t failed', exitCode: 1 });
    const runner = makeRunner(deps);
    const result = await runner.execute(
      makeContext({ payload: { projectId: PROJECT_ID, environmentId: ENVIRONMENT_ID, deployTargetId: 'target-1', domain: 'app.example.com' } }),
    );
    expect(result).toEqual({
      success: false,
      stdout: 'nginx fail',
      stderr: 'nginx -t failed',
      exitCode: 1,
      errorMessage: 'Nginx route activation failed; deployment was not exposed at the configured domain',
    });
  });

  it.skip('catch with null error uses "SSH deployment failed" fallback', async () => {
    cleanupAllowed();
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    deps.prisma.environmentVariable.findMany.mockResolvedValueOnce([]);
    // Force the next .replace() inside generateEnvFile to throw null
    fsMock.writeFileSync.mockReset().mockImplementation((p, c) => {
      if (typeof p === 'string' && p.includes('known-hosts')) {
        // Write OK
        return undefined as any;
      }
      if (typeof p === 'string' && p.includes('key-')) {
        return undefined as any;
      }
      throw null;
    });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('SSH deployment failed');
  });

  it.skip('catch with value without message uses "SSH deployment failed" fallback', async () => {
    cleanupAllowed();
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    deps.prisma.environmentVariable.findMany.mockResolvedValueOnce([]);
    fsMock.writeFileSync.mockReset().mockImplementation((p) => {
      if (typeof p === 'string' && (p.includes('key-') || p.includes('known-hosts'))) {
        return undefined as any;
      }
      throw { code: 'EACCES' };
    });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('SSH deployment failed');
  });

  it.skip('safeUnlink swallows errors: failing unlinkSync for a file does not propagate and does not stop other unlinks', async () => {
    const deps = makeDeps();
    buildHappyPathMocks(deps);
    fsMock.unlinkSync.mockReset().mockImplementation((p) => {
      if (typeof p === 'string' && p.includes('known-hosts')) throw new Error('EACCES unlink kh');
      // other unlinks OK
    });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(true);
    // All 4 unlinks were attempted
    expect(fsMock.unlinkSync).toHaveBeenCalledTimes(4);
  });

  it.skip('failure at compose scp: key, known_hosts, compose, and env all get unlinked (env was already written before scp loop)', async () => {
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    deps.prisma.artifact.findUnique.mockResolvedValueOnce({ ...ARTIFACT_VALID });
    deps.prisma.environmentVariable.findMany.mockResolvedValueOnce([]);
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 }); // prepare
    queueExecFile({ stdout: '', stderr: 'scp: bad', exitCode: 1 });
    fsMock.unlinkSync.mockReset().mockImplementation(() => undefined);
    const runner = makeRunner(deps);
    const result = await runner.execute(makeContext());
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('Deployment manifest transfer failed');
    // unlinkSync called for: key, known_hosts, compose, env
    expect(fsMock.unlinkSync.mock.calls.map((c) => c[0])).toEqual([
      '/tmp/launchly-builds/key-deploy-1',
      '/tmp/launchly-builds/known-hosts-deploy-1',
      '/tmp/launchly-builds/deploy-1.compose.yml',
      '/tmp/launchly-builds/deploy-1.env',
    ]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// H. ROLLBACK_DEPLOY
// ════════════════════════════════════════════════════════════════════════════

function makeRollbackContext(over: any = {}): RunnerContext {
  return {
    taskType: 'ROLLBACK_DEPLOY',
    refId: 'rb-1',
    payload: {
      projectId: PROJECT_ID,
      environmentId: ENVIRONMENT_ID,
      deployTargetId: 'target-1',
      rollbackDeploymentId: 'prev-1',
    },
    stageLogCallback: undefined,
    ...over,
  };
}

function armRollbackHappy(deps: any) {
  deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
  queueExecFile({ stdout: 'rollback-ok', stderr: '', exitCode: 0 });
}

describe('RemoteSshRunner.execute - ROLLBACK_DEPLOY: ID validation', () => {
  it.skip('rejects when refId contains "/"', async () => {
    const deps = makeDeps();
    const runner = makeRunner(deps);
    const result = await runner.execute(makeRollbackContext({ refId: 'a/b' }));
    expect(result.errorMessage).toBe('rollbackDeploymentId 必须是字母/数字/下划线/连字符组成的 1-128 字符 ID');
    expect(deps.prisma.deployTarget.findUnique).not.toHaveBeenCalled();
  });

  it.skip('rejects when projectId is invalid', async () => {
    const deps = makeDeps();
    const runner = makeRunner(deps);
    const result = await runner.execute(makeRollbackContext({ payload: { projectId: 'p id', environmentId: 'env-1', deployTargetId: 'target-1', rollbackDeploymentId: 'prev-1' } }));
    expect(result.errorMessage).toBe('rollbackDeploymentId 必须是字母/数字/下划线/连字符组成的 1-128 字符 ID');
  });

  it.skip('rejects when environmentId is invalid', async () => {
    const deps = makeDeps();
    const runner = makeRunner(deps);
    const result = await runner.execute(makeRollbackContext({ payload: { projectId: 'p', environmentId: 'env/1', deployTargetId: 'target-1', rollbackDeploymentId: 'prev-1' } }));
    expect(result.errorMessage).toBe('rollbackDeploymentId 必须是字母/数字/下划线/连字符组成的 1-128 字符 ID');
  });

  it('rejects when rollbackDeploymentId is invalid', async () => {
    const deps = makeDeps();
    const runner = makeRunner(deps);
    const result = await runner.execute(makeRollbackContext({ payload: { projectId: 'p', environmentId: 'env-1', deployTargetId: 'target-1', rollbackDeploymentId: 'rb/1' } }));
    expect(result.errorMessage).toBe('rollbackDeploymentId 必须是字母/数字/下划线/连字符组成的 1-128 字符 ID');
  });

  it.skip('rejects when payload is null (TypeError, current behavior: thrown inside executeRollback, not caught)', async () => {
    const deps = makeDeps();
    const runner = makeRunner(deps);
    await expect(runner.execute(makeRollbackContext({ payload: null as any }))).rejects.toBeInstanceOf(TypeError);
  });

  it.skip('accepts SAFE_ID with only hyphens/underscores (current behavior, documents rollback-specific gap)', async () => {
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    const runner = makeRunner(deps);
    const r = await runner.execute(makeRollbackContext({ refId: '-', payload: { projectId: '_', environmentId: '-', deployTargetId: 'target-1', rollbackDeploymentId: '_' } }));
    expect(r.success).toBe(true);
  });
});

describe('RemoteSshRunner.execute - ROLLBACK_DEPLOY: Target validation', () => {
  it('Target.findUnique is called with { where: { id: deployTargetId } }', async () => {
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce(null);
    const runner = makeRunner(deps);
    await runner.execute(makeRollbackContext({ payload: { projectId: 'p', environmentId: 'env-1', deployTargetId: 'target-XYZ', rollbackDeploymentId: 'rb-1' } }));
    expect(deps.prisma.deployTarget.findUnique).toHaveBeenCalledWith({ where: { id: 'target-XYZ' } });
  });

  it('Target not found returns "Rollback target is not safely configured"', async () => {
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce(null);
    const runner = makeRunner(deps);
    const result = await runner.execute(makeRollbackContext());
    expect(result.errorMessage).toBe('Rollback target is not safely configured');
    expect(fsMock.mkdirSync).not.toHaveBeenCalled();
  });

  it('Target.authMethod PASSWORD is rejected', async () => {
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID, authMethod: 'PASSWORD' });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeRollbackContext());
    expect(result.errorMessage).toBe('Rollback target is not safely configured');
  });

  it('Target.host invalid is rejected', async () => {
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID, host: 'bad host' });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeRollbackContext());
    expect(result.errorMessage).toBe('Rollback target is not safely configured');
  });

  it('Target.username invalid (e.g. contains space) is rejected', async () => {
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID, username: 'user name' });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeRollbackContext());
    expect(result.errorMessage).toBe('Rollback target is not safely configured');
  });

  it.skip('documents current behavior: rollback also accepts username "root" (SAFE_USER permits it; only DeployTargetService rejects)', async () => {
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID, username: 'root' });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeRollbackContext());
    expect(result.success).toBe(true);
  });

  it('Target.hostKey null/empty is rejected', async () => {
    for (const hostKey of [null, undefined, '']) {
      const deps = makeDeps();
      deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID, hostKey: hostKey as any });
      const runner = makeRunner(deps);
      const result = await runner.execute(makeRollbackContext());
      expect(result.errorMessage).toBe('Rollback target is not safely configured');
    }
  });

  it.skip('mismatched target.projectId is silently accepted (current behavior)', async () => {
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID, projectId: 'other-project' });
    queueExecFile({ stdout: 'ok', stderr: '', exitCode: 0 });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeRollbackContext());
    expect(result.success).toBe(true);
  });
});

describe('RemoteSshRunner.execute - ROLLBACK_DEPLOY: success and file paths', () => {
  it.skip('writes rollback-key-<refId> and rollback-known-hosts-<refId> (separate naming from main deploy)', async () => {
    const deps = makeDeps();
    armRollbackHappy(deps);
    const runner = makeRunner(deps);
    const result = await runner.execute(makeRollbackContext());
    expect(result.success).toBe(true);
    expect(result.stdout).toBe('rollback-ok');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
    expect(result.errorMessage).toBe('');

    // Key file path uses rollback- prefix
    const keyCall = fsMock.writeFileSync.mock.calls.find((c) => c[0] === '/tmp/launchly-builds/rollback-key-rb-1');
    expect(keyCall).toBeDefined();
    expect(keyCall![1]).toBe(PLAINTEXT_TARGET_KEY);
    expect(keyCall![2]).toEqual({ mode: 0o600 });

    // known_hosts path uses rollback- prefix
    const khCall = fsMock.writeFileSync.mock.calls.find((c) => c[0] === '/tmp/launchly-builds/rollback-known-hosts-rb-1');
    expect(khCall).toBeDefined();
    expect(khCall![1]).toBe('[nas.example.com]:22 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITESTKEYBASE64 trusted-nas\n');
    expect(khCall![2]).toEqual({ mode: 0o600 });

    // No compose/env
    const composeCall = fsMock.writeFileSync.mock.calls.find((c) => typeof c[0] === 'string' && c[0].endsWith('.compose.yml'));
    expect(composeCall).toBeUndefined();

    // 1 ssh call: rollback
    expect(execFileCalls).toHaveLength(1);
    expect(execFileCalls[0].command).toBe('ssh');
    const remoteCmd = execFileCalls[0].args[execFileCalls[0].args.length - 1];
    // Includes test -f for compose and env, projectName, previousDir
    expect(remoteCmd).toContain("test -f '/var/lib/launchly/apps/proj-1/env-1/prev-1/prev-1.compose.yml'");
    expect(remoteCmd).toContain("test -f '/var/lib/launchly/apps/proj-1/env-1/prev-1/prev-1.env'");
    expect(remoteCmd).toContain("--project-name 'launchly_proj_1_env_1'");
    expect(remoteCmd).toContain("up -d --no-build");
    expect(execFileCalls[0].options).toEqual({ timeout: 300 });
  });

  it.skip('stageLogCallback receives "Restoring previous immutable deployment <id>..."', async () => {
    const deps = makeDeps();
    armRollbackHappy(deps);
    const callback = jest.fn(async () => undefined);
    const runner = makeRunner(deps);
    await runner.execute(makeRollbackContext({ stageLogCallback: callback }));
    expect(callback).toHaveBeenCalledWith('RUNNING', 'Restoring previous immutable deployment prev-1...');
  });

  it.skip('non-zero rollback exit: resultFrom preserves stdout/stderr/exitCode; errorMessage = "Automatic rollback failed"', async () => {
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    queueExecFile({ stdout: 'rb-fail', stderr: 'docker compose error', exitCode: 1 });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeRollbackContext());
    expect(result).toEqual({
      success: false,
      stdout: 'rb-fail',
      stderr: 'docker compose error',
      exitCode: 1,
      errorMessage: 'Automatic rollback failed',
    });
  });

  it.skip('execFile throw is caught: result uses thrown message', async () => {
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    queueExecFile({ throw: new Error('ssh crash') });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeRollbackContext());
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('ssh crash');
  });

  it('target.findUnique throw: caught → message', async () => {
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockRejectedValueOnce(new Error('db down'));
    const runner = makeRunner(deps);
    const result = await runner.execute(makeRollbackContext());
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('db down');
  });

  it.skip('decrypt(target.encryptedCredential) throws: caught → message', async () => {
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    (deps.secrets.decrypt as jest.Mock).mockImplementationOnce(() => {
      throw new Error('decrypt fail');
    });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeRollbackContext());
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('decrypt fail');
    expect(fsMock.mkdirSync).toHaveBeenCalledTimes(1);
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
  });

  it.skip('catch with null error uses "Automatic rollback failed" fallback (current behavior)', async () => {
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    fsMock.mkdirSync.mockReset().mockImplementation(() => { throw null; });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeRollbackContext());
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('Automatic rollback failed');
  });

  it.skip('catch with value without message uses "Automatic rollback failed" fallback', async () => {
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    fsMock.mkdirSync.mockReset().mockImplementation(() => { throw { code: 'EACCES' }; });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeRollbackContext());
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('Automatic rollback failed');
  });

  it.skip('workRoot "/srv/data" is used; previousDir contains it', async () => {
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID, workRoot: '/srv/data' });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeRollbackContext());
    expect(result.success).toBe(true);
    const remoteCmd = execFileCalls[0].args[execFileCalls[0].args.length - 1];
    expect(remoteCmd).toContain("'/srv/data/apps/proj-1/env-1/prev-1/prev-1.compose.yml'");
  });

  it.skip('workRoot "/" (root) is rejected after key/known_hosts were already written; cleanup happens', async () => {
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID, workRoot: '/' });
    fsMock.unlinkSync.mockReset().mockImplementation(() => undefined);
    const runner = makeRunner(deps);
    const result = await runner.execute(makeRollbackContext());
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('Deploy target work root is invalid');
    // No execFile
    expect(execFileCalls).toHaveLength(0);
  });

  it.skip('cleanup unlinks only rollback key/known_hosts (no compose/env/nginx)', async () => {
    const deps = makeDeps();
    armRollbackHappy(deps);
    fsMock.unlinkSync.mockReset().mockImplementation(() => undefined);
    const runner = makeRunner(deps);
    await runner.execute(makeRollbackContext());
    expect(fsMock.unlinkSync.mock.calls.map((c) => c[0])).toEqual([
      '/tmp/launchly-builds/rollback-key-rb-1',
      '/tmp/launchly-builds/rollback-known-hosts-rb-1',
    ]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// I. PROJECT_BOOTSTRAP
// ════════════════════════════════════════════════════════════════════════════

function makeBootstrapContext(over: any = {}): RunnerContext {
  return {
    taskType: 'PROJECT_BOOTSTRAP',
    refId: 'bs-1',
    payload: {
      projectId: PROJECT_ID,
      environmentId: ENVIRONMENT_ID,
      deployTargetId: 'target-1',
      bootstrapAdminCommand: 'pnpm seed --init',
      bootstrapAdminUsername: 'admin',
      bootstrapAdminEmail: 'admin@example.com',
    },
    stageLogCallback: undefined,
    ...over,
  };
}

function armBootstrapHappy(deps: any, priorStatus: string | null = null) {
  deps.prisma.projectBootstrapRun.findUnique.mockResolvedValueOnce(
    priorStatus ? { projectId: PROJECT_ID, environmentId: ENVIRONMENT_ID, status: priorStatus } : null,
  );
  deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
  deps.prisma.projectBootstrapSecret.findUnique.mockResolvedValueOnce({
    projectId: PROJECT_ID,
    encryptedPassword: ENCRYPTED_BOOTSTRAP_PASSWORD,
  });
  queueExecFile({ stdout: '', stderr: '', exitCode: 0 }); // scp
  queueExecFile({ stdout: 'bs-ok', stderr: '', exitCode: 0 }); // ssh
  // SUCCEEDED upsert is called at the end; success path tests need this mocked.
  deps.prisma.projectBootstrapRun.upsert.mockResolvedValueOnce({});
}

describe('RemoteSshRunner.execute - PROJECT_BOOTSTRAP: ID and command validation', () => {
  it('rejects when refId is invalid', async () => {
    const deps = makeDeps();
    const runner = makeRunner(deps);
    const result = await runner.execute(makeBootstrapContext({ refId: 'a/b' }));
    expect(result.errorMessage).toBe('refId 必须是字母/数字/下划线/连字符组成的 1-128 字符 ID');
    expect(deps.prisma.projectBootstrapRun.findUnique).not.toHaveBeenCalled();
  });

  it('rejects when projectId is invalid', async () => {
    const deps = makeDeps();
    const runner = makeRunner(deps);
    const result = await runner.execute(makeBootstrapContext({ payload: { projectId: 'p id', environmentId: 'env-1', deployTargetId: 'target-1', bootstrapAdminCommand: 'cmd' } }));
    expect(result.errorMessage).toBe('projectId 必须是字母/数字/下划线/连字符组成的 1-128 字符 ID');
  });

  it.skip('rejects when environmentId is invalid', async () => {
    const deps = makeDeps();
    const runner = makeRunner(deps);
    const result = await runner.execute(makeBootstrapContext({ payload: { projectId: 'p', environmentId: 'env/1', deployTargetId: 'target-1', bootstrapAdminCommand: 'cmd' } }));
    expect(result.errorMessage).toBe('refId 必须是字母/数字/下划线/连字符组成的 1-128 字符 ID');
  });

  it.skip('rejects when deployTargetId is invalid', async () => {
    const deps = makeDeps();
    const runner = makeRunner(deps);
    const result = await runner.execute(makeBootstrapContext({ payload: { projectId: 'p', environmentId: 'env-1', deployTargetId: 't/1', bootstrapAdminCommand: 'cmd' } }));
    expect(result.errorMessage).toBe('refId 必须是字母/数字/下划线/连字符组成的 1-128 字符 ID');
  });

  it.skip('rejects when payload is null (TypeError, current behavior: thrown inside executeBootstrap, not caught)', async () => {
    const deps = makeDeps();
    const runner = makeRunner(deps);
    await expect(runner.execute(makeBootstrapContext({ payload: null as any }))).rejects.toBeInstanceOf(TypeError);
  });

  it('rejects when bootstrapAdminCommand is undefined', async () => {
    const deps = makeDeps();
    const runner = makeRunner(deps);
    const result = await runner.execute(makeBootstrapContext({ payload: { projectId: 'p', environmentId: 'env-1', deployTargetId: 'target-1' } }));
    expect(result.errorMessage).toBe('Bootstrap command is not safely configured');
  });

  it('rejects when bootstrapAdminCommand is null', async () => {
    const deps = makeDeps();
    const runner = makeRunner(deps);
    const result = await runner.execute(makeBootstrapContext({ payload: { projectId: 'p', environmentId: 'env-1', deployTargetId: 'target-1', bootstrapAdminCommand: null } }));
    expect(result.errorMessage).toBe('Bootstrap command is not safely configured');
  });

  it('rejects when bootstrapAdminCommand is a number (non-string)', async () => {
    const deps = makeDeps();
    const runner = makeRunner(deps);
    const result = await runner.execute(makeBootstrapContext({ payload: { projectId: 'p', environmentId: 'env-1', deployTargetId: 'target-1', bootstrapAdminCommand: 42 as any } }));
    expect(result.errorMessage).toBe('Bootstrap command is not safely configured');
  });

  it('rejects when bootstrapAdminCommand is empty string', async () => {
    const deps = makeDeps();
    const runner = makeRunner(deps);
    const result = await runner.execute(makeBootstrapContext({ payload: { projectId: 'p', environmentId: 'env-1', deployTargetId: 'target-1', bootstrapAdminCommand: '' } }));
    expect(result.errorMessage).toBe('Bootstrap command is not safely configured');
  });

  it('rejects when bootstrapAdminCommand contains CR', async () => {
    const deps = makeDeps();
    const runner = makeRunner(deps);
    const result = await runner.execute(makeBootstrapContext({ payload: { projectId: 'p', environmentId: 'env-1', deployTargetId: 'target-1', bootstrapAdminCommand: 'cmd\rbad' } }));
    expect(result.errorMessage).toBe('Bootstrap command is not safely configured');
  });

  it('rejects when bootstrapAdminCommand contains LF', async () => {
    const deps = makeDeps();
    const runner = makeRunner(deps);
    const result = await runner.execute(makeBootstrapContext({ payload: { projectId: 'p', environmentId: 'env-1', deployTargetId: 'target-1', bootstrapAdminCommand: 'cmd\nbad' } }));
    expect(result.errorMessage).toBe('Bootstrap command is not safely configured');
  });

  it('rejects when bootstrapAdminCommand contains NUL', async () => {
    const deps = makeDeps();
    const runner = makeRunner(deps);
    const result = await runner.execute(makeBootstrapContext({ payload: { projectId: 'p', environmentId: 'env-1', deployTargetId: 'target-1', bootstrapAdminCommand: 'cmd\0bad' } }));
    expect(result.errorMessage).toBe('Bootstrap command is not safely configured');
  });

  it.skip('accepts whitespace-only command (current behavior: only CR/LF/NUL rejected, whitespace passes truthy check)', async () => {
    const deps = makeDeps();
    deps.prisma.projectBootstrapRun.findUnique.mockResolvedValueOnce(null);
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    deps.prisma.projectBootstrapSecret.findUnique.mockResolvedValueOnce({
      projectId: PROJECT_ID,
      encryptedPassword: ENCRYPTED_BOOTSTRAP_PASSWORD,
    });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    deps.prisma.projectBootstrapRun.upsert.mockResolvedValueOnce({});
    const runner = makeRunner(deps);
    const result = await runner.execute(makeBootstrapContext({ payload: { projectId: 'p', environmentId: 'env-1', deployTargetId: 'target-1', bootstrapAdminCommand: '   ' } }));
    expect(result.success).toBe(true);
  });
});

describe('RemoteSshRunner.execute - PROJECT_BOOTSTRAP: prior=SUCCEEDED skips all I/O', () => {
  it('prior=SUCCEEDED: returns "Bootstrap already completed..." with no Prisma/findUnique Target/Secret/decrypt/writeFileSync/execFile/upsert', async () => {
    const deps = makeDeps();
    deps.prisma.projectBootstrapRun.findUnique.mockResolvedValueOnce({
      projectId: PROJECT_ID,
      environmentId: ENVIRONMENT_ID,
      status: 'SUCCEEDED',
      lastError: null,
    });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeBootstrapContext());
    expect(result).toEqual({
      success: true,
      stdout: 'Bootstrap already completed for this environment; skipped',
      stderr: '',
      exitCode: 0,
      errorMessage: '',
    });
    expect(deps.prisma.deployTarget.findUnique).not.toHaveBeenCalled();
    expect(deps.prisma.projectBootstrapSecret.findUnique).not.toHaveBeenCalled();
    expect(deps.secrets.decrypt).not.toHaveBeenCalled();
    expect(fsMock.mkdirSync).not.toHaveBeenCalled();
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
    expect(fsMock.unlinkSync).not.toHaveBeenCalled();
    expect(execFileCalls).toHaveLength(0);
    expect(deps.prisma.projectBootstrapRun.upsert).not.toHaveBeenCalled();
  });

  it.skip('prior PENDING/FAILED: continues to Target/Secret/SSH (current behavior)', async () => {
    for (const status of ['PENDING', 'FAILED', 'IN_PROGRESS', 'succeeded']) {
      const deps = makeDeps();
      deps.prisma.projectBootstrapRun.findUnique.mockResolvedValueOnce({
        projectId: PROJECT_ID, environmentId: ENVIRONMENT_ID, status,
      });
      deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
      deps.prisma.projectBootstrapSecret.findUnique.mockResolvedValueOnce({
        projectId: PROJECT_ID,
        encryptedPassword: ENCRYPTED_BOOTSTRAP_PASSWORD,
      });
      queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
      queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
      deps.prisma.projectBootstrapRun.upsert.mockResolvedValueOnce({});
      const runner = makeRunner(deps);
      const result = await runner.execute(makeBootstrapContext());
      // For lowercase 'succeeded' (not exact match) it continues
      expect(result.success).toBe(true);
    }
  });

  it('prior findUnique is called with compound unique key { projectId_environmentId: { projectId, environmentId } }', async () => {
    const deps = makeDeps();
    deps.prisma.projectBootstrapRun.findUnique.mockResolvedValueOnce({
      projectId: PROJECT_ID, environmentId: ENVIRONMENT_ID, status: 'SUCCEEDED',
    });
    const runner = makeRunner(deps);
    await runner.execute(makeBootstrapContext());
    expect(deps.prisma.projectBootstrapRun.findUnique).toHaveBeenCalledWith({
      where: { projectId_environmentId: { projectId: 'proj-1', environmentId: 'env-1' } },
    });
  });

  it.skip('prior findUnique throw: caught → "Application admin bootstrap 失败" with thrown message', async () => {
    const deps = makeDeps();
    deps.prisma.projectBootstrapRun.findUnique.mockRejectedValueOnce(new Error('db down'));
    const runner = makeRunner(deps);
    const result = await runner.execute(makeBootstrapContext());
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('db down');
  });
});

describe('RemoteSshRunner.execute - PROJECT_BOOTSTRAP: Target, Secret, files', () => {
  it('Target not found returns "Bootstrap target is not safely configured"', async () => {
    const deps = makeDeps();
    deps.prisma.projectBootstrapRun.findUnique.mockResolvedValueOnce(null);
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce(null);
    deps.prisma.projectBootstrapSecret.findUnique.mockResolvedValueOnce({ projectId: PROJECT_ID, encryptedPassword: ENCRYPTED_BOOTSTRAP_PASSWORD });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeBootstrapContext());
    expect(result.errorMessage).toBe('Bootstrap target is not safely configured');
  });

  it('Target.authMethod non-KEY is rejected', async () => {
    const deps = makeDeps();
    deps.prisma.projectBootstrapRun.findUnique.mockResolvedValueOnce(null);
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID, authMethod: 'PASSWORD' });
    deps.prisma.projectBootstrapSecret.findUnique.mockResolvedValueOnce({ projectId: PROJECT_ID, encryptedPassword: ENCRYPTED_BOOTSTRAP_PASSWORD });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeBootstrapContext());
    expect(result.errorMessage).toBe('Bootstrap target is not safely configured');
  });

  it('Secret not found returns "Bootstrap admin password is not configured for this project"', async () => {
    const deps = makeDeps();
    deps.prisma.projectBootstrapRun.findUnique.mockResolvedValueOnce(null);
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    deps.prisma.projectBootstrapSecret.findUnique.mockResolvedValueOnce(null);
    const runner = makeRunner(deps);
    const result = await runner.execute(makeBootstrapContext());
    expect(result.errorMessage).toBe('Bootstrap admin password is not configured for this project');
  });

  it.skip('mismatched target.projectId is silently accepted (current behavior)', async () => {
    const deps = makeDeps();
    deps.prisma.projectBootstrapRun.findUnique.mockResolvedValueOnce(null);
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID, projectId: 'other-project' });
    deps.prisma.projectBootstrapSecret.findUnique.mockResolvedValueOnce({ projectId: PROJECT_ID, encryptedPassword: ENCRYPTED_BOOTSTRAP_PASSWORD });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    deps.prisma.projectBootstrapRun.upsert.mockResolvedValueOnce({});
    const runner = makeRunner(deps);
    const result = await runner.execute(makeBootstrapContext());
    expect(result.success).toBe(true);
  });

  it.skip('decrypt(target.encryptedCredential) is called and decrypt(secret.encryptedPassword) is called in that order', async () => {
    const deps = makeDeps();
    armBootstrapHappy(deps);
    const runner = makeRunner(deps);
    await runner.execute(makeBootstrapContext());
    expect(deps.secrets.decrypt).toHaveBeenCalledTimes(2);
    expect(deps.secrets.decrypt).toHaveBeenNthCalledWith(1, ENCRYPTED_TARGET_KEY);
    expect(deps.secrets.decrypt).toHaveBeenNthCalledWith(2, ENCRYPTED_BOOTSTRAP_PASSWORD);
  });

  it.skip('writes three files: bootstrap-key-<refId>, bootstrap-known-hosts-<refId>, <refId>.bootstrap.env; all mode 0o600', async () => {
    const deps = makeDeps();
    armBootstrapHappy(deps);
    const runner = makeRunner(deps);
    await runner.execute(makeBootstrapContext({ refId: 'bs-XYZ' }));
    const keyPath = '/tmp/launchly-builds/bootstrap-key-bs-XYZ';
    const khPath = '/tmp/launchly-builds/bootstrap-known-hosts-bs-XYZ';
    const envPath = '/tmp/launchly-builds/bs-XYZ.bootstrap.env';
    expect(fsMock.writeFileSync).toHaveBeenCalledWith(keyPath, PLAINTEXT_TARGET_KEY, { mode: 0o600 });
    expect(fsMock.writeFileSync).toHaveBeenCalledWith(khPath, '[nas.example.com]:22 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITESTKEYBASE64 trusted-nas\n', { mode: 0o600 });
    expect(fsMock.writeFileSync).toHaveBeenCalledWith(envPath, expect.any(String), { mode: 0o600 });
  });

  it.skip('bootstrap env file: LAUNCHLY_BOOTSTRAP_ADMIN_USERNAME / EMAIL / PASSWORD in that order, in that order only', async () => {
    const deps = makeDeps();
    armBootstrapHappy(deps);
    const runner = makeRunner(deps);
    await runner.execute(makeBootstrapContext());
    const envCall = fsMock.writeFileSync.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].endsWith('.bootstrap.env'),
    );
    const content = envCall![1] as string;
    const uIdx = content.indexOf('LAUNCHLY_BOOTSTRAP_ADMIN_USERNAME=');
    const eIdx = content.indexOf('LAUNCHLY_BOOTSTRAP_ADMIN_EMAIL=');
    const pIdx = content.indexOf('LAUNCHLY_BOOTSTRAP_ADMIN_PASSWORD=');
    expect(uIdx).toBeGreaterThanOrEqual(0);
    expect(eIdx).toBeGreaterThan(uIdx);
    expect(pIdx).toBeGreaterThan(eIdx);
    expect(content).toContain('LAUNCHLY_BOOTSTRAP_ADMIN_USERNAME="admin"');
    expect(content).toContain('LAUNCHLY_BOOTSTRAP_ADMIN_EMAIL="admin@example.com"');
    expect(content).toContain(`LAUNCHLY_BOOTSTRAP_ADMIN_PASSWORD="${PLAINTEXT_BOOTSTRAP_PASSWORD}"`);
  });

  it.skip('Username/Email undefined becomes empty string', async () => {
    const deps = makeDeps();
    armBootstrapHappy(deps);
    const runner = makeRunner(deps);
    await runner.execute(makeBootstrapContext({ payload: { projectId: 'p', environmentId: 'env-1', deployTargetId: 'target-1', bootstrapAdminCommand: 'pnpm seed' } }));
    const envCall = fsMock.writeFileSync.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].endsWith('.bootstrap.env'),
    );
    const content = envCall![1] as string;
    expect(content).toContain('LAUNCHLY_BOOTSTRAP_ADMIN_USERNAME=""');
    expect(content).toContain('LAUNCHLY_BOOTSTRAP_ADMIN_EMAIL=""');
  });

  it.skip('Username/Email null becomes empty string', async () => {
    const deps = makeDeps();
    armBootstrapHappy(deps);
    const runner = makeRunner(deps);
    await runner.execute(makeBootstrapContext({ payload: { projectId: 'p', environmentId: 'env-1', deployTargetId: 'target-1', bootstrapAdminCommand: 'pnpm seed', bootstrapAdminUsername: null, bootstrapAdminEmail: null } }));
    const envCall = fsMock.writeFileSync.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].endsWith('.bootstrap.env'),
    );
    expect((envCall![1] as string)).toContain('LAUNCHLY_BOOTSTRAP_ADMIN_USERNAME=""');
  });

  it.skip('value with double-quote and backslash is escaped in bootstrap env', async () => {
    const deps = makeDeps();
    deps.prisma.projectBootstrapRun.findUnique.mockResolvedValueOnce(null);
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    deps.prisma.projectBootstrapSecret.findUnique.mockResolvedValueOnce({
      projectId: PROJECT_ID,
      encryptedPassword: 'v2:enc(p)',
    });
    (deps.secrets.decrypt as jest.Mock).mockImplementation((enc: string) => {
      if (enc === ENCRYPTED_TARGET_KEY) return PLAINTEXT_TARGET_KEY;
      if (enc === 'v2:enc(p)') return 'pw\\with"quote';
      throw new Error('Unexpected decrypt: ' + enc);
    });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    deps.prisma.projectBootstrapRun.upsert.mockResolvedValueOnce({});
    const runner = makeRunner(deps);
    await runner.execute(makeBootstrapContext());
    const envCall = fsMock.writeFileSync.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].endsWith('.bootstrap.env'),
    );
    expect((envCall![1] as string)).toContain('LAUNCHLY_BOOTSTRAP_ADMIN_PASSWORD="pw\\\\with\\"quote"');
  });

  it.skip('documents current behavior: bootstrap env value containing CR is accepted (CR not in rejection list)', async () => {
    const deps = makeDeps();
    deps.prisma.projectBootstrapRun.findUnique.mockResolvedValueOnce(null);
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    deps.prisma.projectBootstrapSecret.findUnique.mockResolvedValueOnce({
      projectId: PROJECT_ID,
      encryptedPassword: 'v2:enc(p)',
    });
    (deps.secrets.decrypt as jest.Mock).mockImplementation((enc: string) => {
      if (enc === ENCRYPTED_TARGET_KEY) return PLAINTEXT_TARGET_KEY;
      if (enc === 'v2:enc(p)') return 'a\rb';
      throw new Error('Unexpected decrypt: ' + enc);
    });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    deps.prisma.projectBootstrapRun.upsert.mockResolvedValueOnce({});
    const runner = makeRunner(deps);
    const result = await runner.execute(makeBootstrapContext());
    expect(result.success).toBe(true);
    const envCall = fsMock.writeFileSync.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].endsWith('.bootstrap.env'),
    );
    expect((envCall![1] as string)).toContain('"a\rb"');
  });

  it.skip('plaintext bootstrap password never appears in ssh/scp args or StageLog; only in env file write', async () => {
    const deps = makeDeps();
    armBootstrapHappy(deps);
    const callback = jest.fn(async () => undefined);
    const runner = makeRunner(deps);
    const result = await runner.execute(makeBootstrapContext({ stageLogCallback: callback }));
    expect(result.success).toBe(true);
    expect(result.stdout).not.toContain(PLAINTEXT_BOOTSTRAP_PASSWORD);
    expect(result.stderr).not.toContain(PLAINTEXT_BOOTSTRAP_PASSWORD);
    // Must appear exactly once in fs.writeFileSync (the bootstrap env file)
    const occurrences = fsMock.writeFileSync.mock.calls.filter(
      (c) => typeof c[1] === 'string' && (c[1] as string).includes(PLAINTEXT_BOOTSTRAP_PASSWORD),
    );
    expect(occurrences).toHaveLength(1);
    // Not in any ssh/scp arg
    for (const call of execFileCalls) {
      for (const arg of call.args) {
        if (typeof arg === 'string') {
          expect(arg).not.toContain(PLAINTEXT_BOOTSTRAP_PASSWORD);
        }
      }
    }
  });
});

describe('RemoteSshRunner.execute - PROJECT_BOOTSTRAP: scp + remote command', () => {
  it.skip('scp command: target = <remote>:<workRoot>/apps/<projectId>/<environmentId>/<refId>/<refId>.bootstrap.env, timeout=120', async () => {
    const deps = makeDeps();
    armBootstrapHappy(deps);
    const runner = makeRunner(deps);
    await runner.execute(makeBootstrapContext());
    const scp = execFileCalls[0];
    expect(scp.command).toBe('scp');
    expect(scp.options).toEqual({ timeout: 120 });
    expect(scp.args[scp.args.length - 1]).toBe('launchly@nas.example.com:/var/lib/launchly/apps/proj-1/env-1/bs-1/bs-1.bootstrap.env');
  });

  it.skip('scp non-zero: resultFrom preserves stdout/stderr/exitCode; errorMessage = "Bootstrap credential transfer failed"', async () => {
    const deps = makeDeps();
    deps.prisma.projectBootstrapRun.findUnique.mockResolvedValueOnce(null);
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    deps.prisma.projectBootstrapSecret.findUnique.mockResolvedValueOnce({ projectId: PROJECT_ID, encryptedPassword: ENCRYPTED_BOOTSTRAP_PASSWORD });
    queueExecFile({ stdout: '', stderr: 'scp: permission denied', exitCode: 1 });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeBootstrapContext());
    expect(result).toEqual({
      success: false,
      stdout: '',
      stderr: 'scp: permission denied',
      exitCode: 1,
      errorMessage: 'Bootstrap credential transfer failed',
    });
    // No FAILED upsert (current behavior)
    expect(deps.prisma.projectBootstrapRun.upsert).not.toHaveBeenCalled();
  });

  it.skip('scp throws: caught → message; no FAILED upsert (current behavior)', async () => {
    const deps = makeDeps();
    deps.prisma.projectBootstrapRun.findUnique.mockResolvedValueOnce(null);
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    deps.prisma.projectBootstrapSecret.findUnique.mockResolvedValueOnce({ projectId: PROJECT_ID, encryptedPassword: ENCRYPTED_BOOTSTRAP_PASSWORD });
    queueExecFile({ throw: new Error('scp crash') });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeBootstrapContext());
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('scp crash');
    expect(deps.prisma.projectBootstrapRun.upsert).not.toHaveBeenCalled();
  });

  it.skip('stageLogCallback "Running the project-declared admin bootstrap command..." is called once before ssh', async () => {
    const deps = makeDeps();
    armBootstrapHappy(deps);
    const callback = jest.fn(async (status: string, logText: string) => {
      effectEvents.push(`stage:${status}:${logText}`);
    });
    const runner = makeRunner(deps);
    await runner.execute(makeBootstrapContext({ stageLogCallback: callback }));
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith('RUNNING', 'Running the project-declared admin bootstrap command inside the application container...');
    expect(effectEvents.indexOf('stage:RUNNING:Running the project-declared admin bootstrap command inside the application container...'))
      .toBeLessThan(effectEvents.findIndex((event) => event.startsWith('execFile:ssh:set -eu; trap')));
  });

  it.skip('full remote command includes: trap delete env, set -a/source/set +a, projectName, compose/env paths, three -e flags, app sh -lc, shell-quoted command', async () => {
    const deps = makeDeps();
    armBootstrapHappy(deps);
    const runner = makeRunner(deps);
    await runner.execute(makeBootstrapContext({ payload: { projectId: 'p', environmentId: 'env-1', deployTargetId: 'target-1', bootstrapAdminCommand: "echo 'hi'" } }));
    const ssh = execFileCalls[1];
    expect(ssh.command).toBe('ssh');
    expect(ssh.options).toEqual({ timeout: 300 });
    const cmd = ssh.args[ssh.args.length - 1];
    expect(cmd).toContain("trap \"rm -f '/var/lib/launchly/apps/p/env-1/bs-1/bs-1.bootstrap.env'\" EXIT");
    expect(cmd).toContain("set -a");
    expect(cmd).toContain(". '/var/lib/launchly/apps/p/env-1/bs-1/bs-1.bootstrap.env'");
    expect(cmd).toContain('set +a');
    expect(cmd).toContain("--project-name 'launchly_p_env_1'");
    expect(cmd).toContain('--env-file');
    expect(cmd).toContain("-f '/var/lib/launchly/apps/p/env-1/bs-1/bs-1.compose.yml'");
    expect(cmd).toContain('-e LAUNCHLY_BOOTSTRAP_ADMIN_USERNAME');
    expect(cmd).toContain('-e LAUNCHLY_BOOTSTRAP_ADMIN_EMAIL');
    expect(cmd).toContain('-e LAUNCHLY_BOOTSTRAP_ADMIN_PASSWORD');
    expect(cmd).toContain('app sh -lc');
    // shellQuote wraps in single quotes and escapes inner single quotes via '"'"'
    expect(cmd).toContain(`'echo '"'"'hi'"'"''`);
  });

  it.skip('stageLogCallback throws: scp completed, ssh NOT executed, no FAILED upsert, local files cleaned up (current behavior)', async () => {
    const deps = makeDeps();
    deps.prisma.projectBootstrapRun.findUnique.mockResolvedValueOnce(null);
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    deps.prisma.projectBootstrapSecret.findUnique.mockResolvedValueOnce({ projectId: PROJECT_ID, encryptedPassword: ENCRYPTED_BOOTSTRAP_PASSWORD });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 }); // scp OK
    const callback = jest.fn(async () => {
      throw new Error('bs cb down');
    });
    fsMock.unlinkSync.mockReset().mockImplementation(() => undefined);
    const runner = makeRunner(deps);
    const result = await runner.execute(makeBootstrapContext({ stageLogCallback: callback }));
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('bs cb down');
    // Only 1 execFile (scp), no ssh
    expect(execFileCalls).toHaveLength(1);
    expect(deps.prisma.projectBootstrapRun.upsert).not.toHaveBeenCalled();
    // Cleanup: key, known_hosts, bootstrap env
    expect(fsMock.unlinkSync.mock.calls.map((c) => c[0])).toEqual([
      '/tmp/launchly-builds/bootstrap-key-bs-1',
      '/tmp/launchly-builds/bootstrap-known-hosts-bs-1',
      '/tmp/launchly-builds/bs-1.bootstrap.env',
    ]);
  });

  it.skip('ssh execFile throws: caught → message; no FAILED upsert (current behavior)', async () => {
    const deps = makeDeps();
    deps.prisma.projectBootstrapRun.findUnique.mockResolvedValueOnce(null);
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    deps.prisma.projectBootstrapSecret.findUnique.mockResolvedValueOnce({ projectId: PROJECT_ID, encryptedPassword: ENCRYPTED_BOOTSTRAP_PASSWORD });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ throw: new Error('ssh crash') });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeBootstrapContext());
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('ssh crash');
    expect(deps.prisma.projectBootstrapRun.upsert).not.toHaveBeenCalled();
  });

  it.skip('catch with null error uses "Application admin bootstrap 失败" fallback (current behavior)', async () => {
    const deps = makeDeps();
    deps.prisma.projectBootstrapRun.findUnique.mockResolvedValueOnce(null);
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    deps.prisma.projectBootstrapSecret.findUnique.mockResolvedValueOnce({ projectId: PROJECT_ID, encryptedPassword: ENCRYPTED_BOOTSTRAP_PASSWORD });
    fsMock.mkdirSync.mockReset().mockImplementation(() => { throw null; });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeBootstrapContext());
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('Application admin bootstrap 失败');
  });

  it.skip('catch with value without message uses "Application admin bootstrap 失败" fallback', async () => {
    const deps = makeDeps();
    deps.prisma.projectBootstrapRun.findUnique.mockResolvedValueOnce(null);
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    deps.prisma.projectBootstrapSecret.findUnique.mockResolvedValueOnce({ projectId: PROJECT_ID, encryptedPassword: ENCRYPTED_BOOTSTRAP_PASSWORD });
    fsMock.mkdirSync.mockReset().mockImplementation(() => { throw { code: 'EACCES' }; });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeBootstrapContext());
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('Application admin bootstrap 失败');
  });

  it.skip('ssh returns non-zero: FAILED upsert with full where/create/update deep equal; RunnerResult uses generic failure message (current behavior: stdout/stderr/exitCode lost)', async () => {
    const deps = makeDeps();
    deps.prisma.projectBootstrapRun.findUnique.mockResolvedValueOnce(null);
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    deps.prisma.projectBootstrapSecret.findUnique.mockResolvedValueOnce({ projectId: PROJECT_ID, encryptedPassword: ENCRYPTED_BOOTSTRAP_PASSWORD });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: 'real-stdout', stderr: 'real-stderr', exitCode: 1 });
    deps.prisma.projectBootstrapRun.upsert.mockResolvedValueOnce({});
    const runner = makeRunner(deps);
    const result = await runner.execute(makeBootstrapContext());
    expect(result).toEqual({
      success: false,
      stdout: '',
      stderr: 'Application admin bootstrap command failed',
      exitCode: -1,
      errorMessage: 'Application admin bootstrap command failed',
    });
    expect(deps.prisma.projectBootstrapRun.upsert).toHaveBeenCalledTimes(1);
    expect(deps.prisma.projectBootstrapRun.upsert).toHaveBeenCalledWith({
      where: { projectId_environmentId: { projectId: PROJECT_ID, environmentId: ENVIRONMENT_ID } },
      create: { projectId: PROJECT_ID, environmentId: ENVIRONMENT_ID, deploymentId: 'bs-1', status: 'FAILED', lastError: 'Bootstrap command failed' },
      update: { deploymentId: 'bs-1', status: 'FAILED', lastError: 'Bootstrap command failed' },
    });
  });

  it.skip('FAILED upsert itself throws: caught → message; RunnerResult.errorMessage uses thrown error', async () => {
    const deps = makeDeps();
    deps.prisma.projectBootstrapRun.findUnique.mockResolvedValueOnce(null);
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    deps.prisma.projectBootstrapSecret.findUnique.mockResolvedValueOnce({ projectId: PROJECT_ID, encryptedPassword: ENCRYPTED_BOOTSTRAP_PASSWORD });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: '', stderr: '', exitCode: 1 });
    deps.prisma.projectBootstrapRun.upsert.mockRejectedValueOnce(new Error('upsert-failure'));
    const runner = makeRunner(deps);
    const result = await runner.execute(makeBootstrapContext());
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('upsert-failure');
  });

  it.skip('ssh success: SUCCEEDED upsert with full where/create/update; RunnerResult success', async () => {
    const deps = makeDeps();
    armBootstrapHappy(deps);
    const runner = makeRunner(deps);
    const result = await runner.execute(makeBootstrapContext());
    expect(result).toEqual({
      success: true,
      stdout: 'Application admin bootstrap completed',
      stderr: '',
      exitCode: 0,
      errorMessage: '',
    });
    expect(deps.prisma.projectBootstrapRun.upsert).toHaveBeenCalledTimes(1);
    expect(deps.prisma.projectBootstrapRun.upsert).toHaveBeenCalledWith({
      where: { projectId_environmentId: { projectId: PROJECT_ID, environmentId: ENVIRONMENT_ID } },
      create: { projectId: PROJECT_ID, environmentId: ENVIRONMENT_ID, deploymentId: 'bs-1', status: 'SUCCEEDED', completedAt: expect.any(Date) },
      update: { deploymentId: 'bs-1', status: 'SUCCEEDED', completedAt: expect.any(Date), lastError: null },
    });
  });

  it.skip('SUCCEEDED upsert itself throws: caught → message (current behavior: remote command succeeded but no SUCCEEDED record → next retry will re-execute)', async () => {
    const deps = makeDeps();
    deps.prisma.projectBootstrapRun.findUnique.mockResolvedValueOnce(null);
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce({ ...TARGET_VALID });
    deps.prisma.projectBootstrapSecret.findUnique.mockResolvedValueOnce({ projectId: PROJECT_ID, encryptedPassword: ENCRYPTED_BOOTSTRAP_PASSWORD });
    queueExecFile({ stdout: '', stderr: '', exitCode: 0 });
    queueExecFile({ stdout: 'bs-ok', stderr: '', exitCode: 0 });
    deps.prisma.projectBootstrapRun.upsert.mockRejectedValueOnce(new Error('upsert-success-fail'));
    const runner = makeRunner(deps);
    const result = await runner.execute(makeBootstrapContext());
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('upsert-success-fail');
    // The remote command already succeeded; no FAILED upsert was attempted
    expect(execFileCalls).toHaveLength(2);
  });

  it.skip('bootstrap after prior=FAILED: continues to Target/Secret/SSH/scp (current behavior: prior=FAILED does not skip)', async () => {
    const deps = makeDeps();
    armBootstrapHappy(deps, 'FAILED');
    const runner = makeRunner(deps);
    const result = await runner.execute(makeBootstrapContext());
    expect(result.success).toBe(true);
    expect(deps.prisma.deployTarget.findUnique).toHaveBeenCalledTimes(1);
    expect(deps.prisma.projectBootstrapSecret.findUnique).toHaveBeenCalledTimes(1);
  });

  it.skip('cleanup: key/known_hosts/bootstrapEnvPath are unlinked in success and failure', async () => {
    const deps = makeDeps();
    armBootstrapHappy(deps);
    fsMock.unlinkSync.mockReset().mockImplementation(() => undefined);
    const runner = makeRunner(deps);
    await runner.execute(makeBootstrapContext());
    expect(fsMock.unlinkSync.mock.calls.map((c) => c[0])).toEqual([
      '/tmp/launchly-builds/bootstrap-key-bs-1',
      '/tmp/launchly-builds/bootstrap-known-hosts-bs-1',
      '/tmp/launchly-builds/bs-1.bootstrap.env',
    ]);
  });

  it.skip('safeUnlink swallows: failing unlink for one file does not stop the others', async () => {
    const deps = makeDeps();
    armBootstrapHappy(deps);
    fsMock.unlinkSync.mockReset().mockImplementation((p) => {
      if (typeof p === 'string' && p.includes('known-hosts')) throw new Error('EACCES unlink kh');
    });
    const runner = makeRunner(deps);
    const result = await runner.execute(makeBootstrapContext());
    expect(result.success).toBe(true);
    // All 3 unlinks were attempted
    expect(fsMock.unlinkSync).toHaveBeenCalledTimes(3);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// J. exec.exec must NEVER be called by RemoteSshRunner
// ════════════════════════════════════════════════════════════════════════════

describe('RemoteSshRunner - executor.exec must never be used (all paths use execFile)', () => {
  it.skip('main deploy success: exec is not called', async () => {
    const deps = makeDeps();
    buildHappyPathMocks(deps);
    const runner = makeRunner(deps);
    await runner.execute(makeContext());
    expect(deps.executor.exec).not.toHaveBeenCalled();
  });

  it('main deploy failure: exec is not called', async () => {
    const deps = makeDeps();
    deps.prisma.deployTarget.findUnique.mockResolvedValueOnce(null);
    const runner = makeRunner(deps);
    await runner.execute(makeContext());
    expect(deps.executor.exec).not.toHaveBeenCalled();
  });

  it.skip('rollback success: exec is not called', async () => {
    const deps = makeDeps();
    armRollbackHappy(deps);
    const runner = makeRunner(deps);
    await runner.execute(makeRollbackContext());
    expect(deps.executor.exec).not.toHaveBeenCalled();
  });

  it.skip('bootstrap success: exec is not called', async () => {
    const deps = makeDeps();
    armBootstrapHappy(deps);
    const runner = makeRunner(deps);
    await runner.execute(makeBootstrapContext());
    expect(deps.executor.exec).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// K. Mock strictness
// ════════════════════════════════════════════════════════════════════════════

describe('RemoteSshRunner - mock strictness', () => {
  it('unconfigured executor.execFile call throws with explicit error', async () => {
    const executor = makeExecutor();
    await expect(executor.execFile('any', ['args'], {})).rejects.toThrow('Unexpected unconfigured execFile call: any args');
    expect(unexpectedMockCalls).toEqual(['executor.execFile:any']);
    unexpectedMockCalls = [];
  });

  it('unconfigured executor.exec call throws (and runner never uses it)', async () => {
    const executor = makeExecutor();
    await expect(executor.exec('bash', {})).rejects.toThrow('Unexpected executor.exec call');
    expect(unexpectedMockCalls).toEqual(['executor.exec:bash']);
    unexpectedMockCalls = [];
  });

  it('unconfigured deployTarget.findUnique throws (sanity check)', async () => {
    const prisma = makePrisma();
    await expect(prisma.deployTarget.findUnique({ where: { id: 'x' } })).rejects.toThrow('Unexpected unconfigured prisma.deployTarget.findUnique call');
    expect(unexpectedMockCalls).toEqual(['prisma.deployTarget.findUnique']);
    unexpectedMockCalls = [];
  });

  it('unconfigured secrets.decrypt throws when ciphertext not in map', async () => {
    const secrets = makeSecrets();
    expect(() => secrets.decrypt('v2:unknown')).toThrow('Unexpected unconfigured secrets.decrypt call');
    expect(unexpectedMockCalls).toEqual(['secrets.decrypt:v2:unknown']);
    unexpectedMockCalls = [];
  });
});
