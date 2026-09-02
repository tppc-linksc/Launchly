import * as fs from 'fs';
import { RemoteSshRunner } from './remote-ssh.runner';
import { CommandExecutor } from './command.executor';
import { RunnerContext } from './runner.factory';

vi.mock('fs', async () => ({
  ...(await vi.importActual<typeof import('fs')>('fs')),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  rmdirSync: vi.fn(),
}));

const fsMock = fs as vi.Mocked<typeof fs>;

const HOST_KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITESTKEYBASE64';
const PRIVATE_KEY = 'PRIVATE_KEY_VALUE';
const ADMIN_PASSWORD = 'ADMIN_PASSWORD_VALUE';
const ENV_SECRET = 'ENV_SECRET_VALUE';

const TARGET = {
  id: 'target-1',
  projectId: 'proj-1',
  host: 'nas.example.com',
  port: 22,
  username: 'launchly',
  authMethod: 'KEY',
  encryptedCredential: 'enc-target-key',
  hostKey: HOST_KEY,
  workRoot: '/var/lib/launchly',
};

const ARTIFACT = {
  id: 'artifact-1',
  projectId: 'proj-1',
  imageRef: 'registry.example.com/team/app',
  digest: `sha256:${'a'.repeat(64)}`,
};

const ok = (stdout = '', stderr = '') => ({ stdout, stderr, exitCode: 0 });
const failed = (exitCode = 1, stdout = '', stderr = 'failed') => ({ stdout, stderr, exitCode });

describe('RemoteSshRunner', () => {
  let execFile: vi.Mock;
  let executor: CommandExecutor;
  let secrets: { decrypt: vi.Mock };
  let prisma: any;
  let runner: RemoteSshRunner;

  function context(overrides: Partial<RunnerContext> & { payload?: Record<string, any> } = {}): RunnerContext {
    const base: RunnerContext = {
      taskType: 'PROJECT_DEPLOY',
      refId: 'deploy-1',
      payload: {
        projectId: 'proj-1',
        environmentId: 'env-1',
        deployTargetId: 'target-1',
        port: 3000,
      },
    };
    return {
      ...base,
      ...overrides,
      payload: { ...base.payload, ...(overrides.payload || {}) },
    };
  }

  function queueResults(...results: Array<{ stdout: string; stderr: string; exitCode: number }>) {
    for (const result of results) execFile.mockResolvedValueOnce(result);
  }

  function prepareMain(overrides: { target?: any; artifact?: any; variables?: any[] } = {}) {
    prisma.deployTarget.findUnique.mockResolvedValue(overrides.target ?? TARGET);
    prisma.deployment.findUnique.mockResolvedValue({ artifact: overrides.artifact ?? ARTIFACT });
    prisma.environmentVariable.findMany.mockResolvedValue(overrides.variables ?? []);
  }

  function queueMainSuccess(deployStdout = 'deployed') {
    queueResults(
      ok(), // create remote directory
      ok(), // copy compose.yml
      ok(), // copy app.env
      ok(deployStdout), // deploy immutable image
      ok(), // prune old snapshots
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    execFile = vi.fn().mockRejectedValue(new Error('unexpected execFile call'));
    executor = {
      execFile,
      exec: vi.fn().mockRejectedValue(new Error('shell execution is forbidden')),
      sanitize: CommandExecutor.sanitize,
    } as unknown as CommandExecutor;
    secrets = {
      decrypt: vi.fn((ciphertext: string) => {
        const values: Record<string, string> = {
          'enc-target-key': PRIVATE_KEY,
          'enc-admin-password': ADMIN_PASSWORD,
          'enc-env-secret': ENV_SECRET,
        };
        if (!(ciphertext in values)) throw new Error(`unknown ciphertext: ${ciphertext}`);
        return values[ciphertext];
      }),
    };
    prisma = {
      deployTarget: { findUnique: vi.fn() },
      deployment: { findUnique: vi.fn() },
      artifact: { findUnique: vi.fn() },
      environmentVariable: { findMany: vi.fn() },
      projectBootstrapRun: { findUnique: vi.fn(), upsert: vi.fn().mockResolvedValue({}) },
      projectBootstrapSecret: { findUnique: vi.fn() },
    };
    runner = new RemoteSshRunner(executor, secrets as any, prisma);
  });

  describe('main deployment validation', () => {
    it.each([
      ['refId', { refId: '../escape' }],
      ['projectId', { payload: { projectId: 'bad/id' } }],
      ['environmentId', { payload: { environmentId: 'bad id' } }],
    ])('rejects an unsafe %s before database access', async (_label, overrides) => {
      const result = await runner.execute(context(overrides as any));

      expect(result.success).toBe(false);
      expect(prisma.deployTarget.findUnique).not.toHaveBeenCalled();
      expect(execFile).not.toHaveBeenCalled();
    });

    it.each([0, -1, 65536, 1.5, 'invalid'])('rejects invalid port %p', async (port) => {
      const result = await runner.execute(context({ payload: { port } }));

      expect(result.errorMessage).toBe('Invalid deployment identifiers or port');
      expect(prisma.deployTarget.findUnique).not.toHaveBeenCalled();
    });

    it('rejects a missing deployment target', async () => {
      prisma.deployTarget.findUnique.mockResolvedValue(null);

      const result = await runner.execute(context());

      expect(result.errorMessage).toBe('Deploy target not found');
      expect(execFile).not.toHaveBeenCalled();
    });

    it('rejects a deployment target owned by another project', async () => {
      prisma.deployTarget.findUnique.mockResolvedValue({ ...TARGET, projectId: 'proj-other' });

      const result = await runner.execute(context());

      expect(result.errorMessage).toBe('Deploy target does not belong to the deployment project');
      expect(execFile).not.toHaveBeenCalled();
    });

    it.each([
      [{ authMethod: 'PASSWORD' }, 'Only SSH key authentication is supported'],
      [{ host: 'bad host' }, 'Target host, username, or pinned host key is invalid'],
      [{ username: 'bad user' }, 'Target host, username, or pinned host key is invalid'],
      [{ hostKey: '' }, 'Target host, username, or pinned host key is invalid'],
    ])('rejects an unsafe target configuration %#', async (targetChange, message) => {
      prisma.deployTarget.findUnique.mockResolvedValue({ ...TARGET, ...targetChange });

      const result = await runner.execute(context());

      expect(result.errorMessage).toContain(message);
      expect(execFile).not.toHaveBeenCalled();
    });

    it.each([
      [null, 'missing artifact'],
      [{ ...ARTIFACT, digest: 'sha256:short' }, 'invalid digest'],
      [{ ...ARTIFACT, imageRef: 'repo;touch /tmp/pwned' }, 'invalid image reference'],
    ])('rejects %s', async (artifact, _description) => {
      prepareMain({ artifact });
      if (artifact === null) prisma.deployment.findUnique.mockResolvedValue({ artifact: null });
      prisma.artifact.findUnique.mockResolvedValue(null);

      const result = await runner.execute(context());

      expect(result.errorMessage).toBe('Deployment does not have a verified OCI artifact');
      expect(execFile).not.toHaveBeenCalled();
    });

    it('rejects an artifact owned by another project', async () => {
      prepareMain({ artifact: { ...ARTIFACT, projectId: 'proj-other' } });

      const result = await runner.execute(context());

      expect(result.errorMessage).toBe('Artifact does not belong to the deployment project');
      expect(execFile).not.toHaveBeenCalled();
    });

    it('rejects an unsafe work root without running remote commands', async () => {
      prepareMain({ target: { ...TARGET, workRoot: '/srv/../escape' } });

      const result = await runner.execute(context());

      expect(result.errorMessage).toBe('Deploy target work root is invalid');
      expect(execFile).not.toHaveBeenCalled();
    });
  });

  describe('main deployment execution', () => {
    it('deploys an immutable artifact, writes isolated files, and prunes old snapshots portably', async () => {
      prepareMain();
      queueMainSuccess('deploy-ok');

      const result = await runner.execute(context());

      expect(result).toEqual(
        expect.objectContaining({
          success: true,
          stdout: 'deploy-ok',
          exitCode: 0,
        }),
      );
      expect(fsMock.mkdirSync).toHaveBeenCalledWith('/tmp/launchly-builds/work-deploy-1', {
        recursive: true,
        mode: 0o700,
      });
      expect(fsMock.writeFileSync).toHaveBeenCalledWith('/tmp/launchly-builds/work-deploy-1/id_ed25519', PRIVATE_KEY, {
        mode: 0o600,
      });
      const compose = fsMock.writeFileSync.mock.calls.find(([file]) => String(file).endsWith('/compose.yml'));
      expect(String(compose?.[1])).toContain(`registry.example.com/team/app@sha256:${'a'.repeat(64)}`);
      expect(String(compose?.[1])).toContain('"3000:3000"');

      const deployCommand = String(execFile.mock.calls[3][1].at(-1));
      expect(deployCommand).toContain('docker pull');
      expect(deployCommand).toContain('up -d --no-build');
      const retentionCommand = String(execFile.mock.calls[4][1].at(-1));
      expect(retentionCommand).toContain("ls -1dt -- '/var/lib/launchly/apps/proj-1/env-1'/*/");
      expect(retentionCommand).toContain('tail -n +6');
      expect(retentionCommand).not.toContain('find ');
      expect(retentionCommand).not.toContain('-printf');
      expect(executor.exec).not.toHaveBeenCalled();
    });

    it('decrypts environment variables, escapes the env file, and exposes exact redaction values only in memory', async () => {
      prepareMain({
        variables: [
          { key: 'TOKEN', encryptedValue: 'enc-env-secret' },
          { key: 'QUOTED', encryptedValue: 'enc-quoted' },
        ],
      });
      secrets.decrypt.mockImplementation(
        (ciphertext: string) =>
          (
            ({
              'enc-target-key': PRIVATE_KEY,
              'enc-env-secret': ENV_SECRET,
              'enc-quoted': 'a"b\\c',
            }) as Record<string, string>
          )[ciphertext],
      );
      queueMainSuccess();

      const result = await runner.execute(context());

      const env = fsMock.writeFileSync.mock.calls.find(([file]) => String(file).endsWith('/app.env'));
      expect(String(env?.[1])).toBe(`TOKEN="${ENV_SECRET}"\nQUOTED="a\\"b\\\\c"`);
      expect(result.sensitiveValues).toEqual([ENV_SECRET, 'a"b\\c']);
      expect(JSON.stringify(execFile.mock.calls)).not.toContain(ENV_SECRET);
    });

    it('rejects duplicate environment keys instead of silently overwriting them', async () => {
      prepareMain({
        variables: [
          { key: 'TOKEN', encryptedValue: 'enc-env-secret' },
          { key: 'TOKEN', encryptedValue: 'enc-env-secret' },
        ],
      });
      queueResults(ok());

      const result = await runner.execute(context());

      expect(result.errorMessage).toContain('重复的环境变量 key');
      expect(execFile).toHaveBeenCalledTimes(1);
    });

    it('preserves command evidence when preparing the remote directory fails', async () => {
      prepareMain();
      queueResults(failed(23, 'prepare-out', 'prepare-err'));

      const result = await runner.execute(context());

      expect(result).toEqual({
        success: false,
        stdout: 'prepare-out',
        stderr: 'prepare-err',
        exitCode: 23,
        errorMessage: 'Unable to create isolated remote deployment directory',
        sensitiveValues: undefined,
      });
      expect(execFile).toHaveBeenCalledTimes(1);
    });

    it('keeps deployment successful but emits a warning if snapshot pruning fails', async () => {
      const stageLog = vi.fn().mockResolvedValue(undefined);
      prepareMain();
      queueResults(ok(), ok(), ok(), ok('deployed'), failed(1));

      const result = await runner.execute(context({ stageLogCallback: stageLog }));

      expect(result.success).toBe(true);
      expect(stageLog).toHaveBeenCalledWith('RUNNING', 'Warning: old remote deployment snapshots could not be pruned');
    });

    it('configures a domain route only after the immutable deployment succeeds', async () => {
      const stageLog = vi.fn().mockResolvedValue(undefined);
      prepareMain();
      queueResults(
        ok(), // prepare
        ok(),
        ok(),
        ok(), // compose/env/nginx copies
        ok(), // proxy bootstrap
        ok('deployed'),
        ok(), // nginx activation
        ok(), // retention
      );

      const result = await runner.execute(
        context({
          payload: { domain: 'App.Example.COM' },
          stageLogCallback: stageLog,
        }),
      );

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('Nginx route active: http://app.example.com');
      const nginx = fsMock.writeFileSync.mock.calls.find(([file]) => String(file).endsWith('/nginx.conf'));
      expect(String(nginx?.[1])).toContain('server_name app.example.com;');
      expect(stageLog).toHaveBeenCalledWith('RUNNING', 'Activating Nginx route for app.example.com...');
    });

    it('cleans every local secret file and the isolated work directory on success', async () => {
      prepareMain();
      queueMainSuccess();

      await runner.execute(context());

      expect(fsMock.unlinkSync.mock.calls.map(([file]) => file)).toEqual([
        '/tmp/launchly-builds/work-deploy-1/id_ed25519',
        '/tmp/launchly-builds/work-deploy-1/known_hosts',
        '/tmp/launchly-builds/work-deploy-1/compose.yml',
        '/tmp/launchly-builds/work-deploy-1/app.env',
      ]);
      expect(fsMock.rmdirSync).toHaveBeenCalledWith('/tmp/launchly-builds/work-deploy-1');
    });
  });

  describe('rollback', () => {
    function rollbackContext(): RunnerContext {
      return context({
        taskType: 'ROLLBACK_DEPLOY',
        refId: 'rollback-1',
        payload: {
          projectId: 'proj-1',
          environmentId: 'env-1',
          deployTargetId: 'target-1',
          rollbackDeploymentId: 'deploy-previous',
        },
      });
    }

    it('restores compose.yml and app.env from the previous immutable snapshot without rebuilding', async () => {
      const stageLog = vi.fn().mockResolvedValue(undefined);
      prisma.deployTarget.findUnique.mockResolvedValue(TARGET);
      prisma.deployment.findUnique.mockResolvedValue({ projectId: 'proj-1' });
      queueResults(ok('rolled-back'));

      const result = await runner.execute({ ...rollbackContext(), stageLogCallback: stageLog });

      expect(result.success).toBe(true);
      const command = String(execFile.mock.calls[0][1].at(-1));
      expect(command).toContain("test -f '/var/lib/launchly/apps/proj-1/env-1/deploy-previous/compose.yml'");
      expect(command).toContain("--env-file '/var/lib/launchly/apps/proj-1/env-1/deploy-previous/app.env'");
      expect(command).toContain('up -d --no-build');
      expect(command).not.toContain('docker build');
      expect(stageLog).toHaveBeenCalledWith('RUNNING', 'Restoring previous immutable deployment deploy-previous...');
    });

    it('rejects a rollback deployment owned by another project', async () => {
      prisma.deployTarget.findUnique.mockResolvedValue(TARGET);
      prisma.deployment.findUnique.mockResolvedValue({ projectId: 'proj-other' });

      const result = await runner.execute(rollbackContext());

      expect(result.errorMessage).toBe('Rollback target deployment does not belong to the deployment project');
      expect(execFile).not.toHaveBeenCalled();
    });

    it('preserves non-zero rollback command evidence', async () => {
      prisma.deployTarget.findUnique.mockResolvedValue(TARGET);
      prisma.deployment.findUnique.mockResolvedValue({ projectId: 'proj-1' });
      queueResults(failed(17, 'rollback-out', 'rollback-err'));

      const result = await runner.execute(rollbackContext());

      expect(result).toEqual(
        expect.objectContaining({
          success: false,
          stdout: 'rollback-out',
          stderr: 'rollback-err',
          exitCode: 17,
          errorMessage: 'Automatic rollback failed',
        }),
      );
    });
  });

  describe('project bootstrap', () => {
    function bootstrapContext(overrides: Record<string, any> = {}): RunnerContext {
      return context({
        taskType: 'PROJECT_BOOTSTRAP',
        refId: 'bootstrap-1',
        payload: {
          projectId: 'proj-1',
          environmentId: 'env-1',
          deployTargetId: 'target-1',
          bootstrapAdminCommand: 'node scripts/create-admin.js',
          bootstrapAdminUsername: 'admin',
          bootstrapAdminEmail: 'admin@example.com',
          ...overrides,
        },
      });
    }

    it('returns idempotently when bootstrap already succeeded', async () => {
      prisma.projectBootstrapRun.findUnique.mockResolvedValue({ status: 'SUCCEEDED' });

      const result = await runner.execute(bootstrapContext());

      expect(result).toEqual(expect.objectContaining({ success: true }));
      expect(result.stdout).toContain('already completed');
      expect(prisma.deployTarget.findUnique).not.toHaveBeenCalled();
      expect(execFile).not.toHaveBeenCalled();
    });

    it('refuses a concurrent bootstrap run', async () => {
      prisma.projectBootstrapRun.findUnique.mockResolvedValue({ status: 'RUNNING' });

      const result = await runner.execute(bootstrapContext());

      expect(result.errorMessage).toContain('already in progress');
      expect(execFile).not.toHaveBeenCalled();
    });

    it.each(['', 'node seed\nrm -rf /', 'node seed\0suffix'])(
      'rejects unsafe bootstrap command %p',
      async (command) => {
        const result = await runner.execute(bootstrapContext({ bootstrapAdminCommand: command }));

        expect(result.errorMessage).toBe('Bootstrap command is not safely configured');
        expect(prisma.projectBootstrapRun.findUnique).not.toHaveBeenCalled();
      },
    );

    it('runs the project-declared command once and records RUNNING then SUCCEEDED', async () => {
      const stageLog = vi.fn().mockResolvedValue(undefined);
      prisma.projectBootstrapRun.findUnique.mockResolvedValue(null);
      prisma.deployTarget.findUnique.mockResolvedValue(TARGET);
      prisma.projectBootstrapSecret.findUnique.mockResolvedValue({ encryptedPassword: 'enc-admin-password' });
      queueResults(ok(), ok());

      const result = await runner.execute({ ...bootstrapContext(), stageLogCallback: stageLog });

      expect(result).toEqual({
        success: true,
        stdout: 'Application admin bootstrap completed',
        stderr: '',
        exitCode: 0,
        errorMessage: '',
      });
      const env = fsMock.writeFileSync.mock.calls.find(([file]) => String(file).endsWith('/bootstrap.env'));
      expect(String(env?.[1])).toContain(`LAUNCHLY_BOOTSTRAP_ADMIN_PASSWORD="${ADMIN_PASSWORD}"`);
      const command = String(execFile.mock.calls[1][1].at(-1));
      expect(command).toContain('trap "rm -f \'/var/lib/launchly/apps/proj-1/env-1/bootstrap-1/bootstrap.env\'" EXIT');
      expect(command).toContain("app sh -lc 'node scripts/create-admin.js'");
      expect(prisma.projectBootstrapRun.upsert.mock.calls.map(([args]: any[]) => args.create.status)).toEqual([
        'RUNNING',
        'SUCCEEDED',
      ]);
      expect(stageLog).toHaveBeenCalledWith(
        'RUNNING',
        'Running the project-declared admin bootstrap command inside the application container...',
      );
    });

    it('records FAILED when the bootstrap command returns non-zero', async () => {
      prisma.projectBootstrapRun.findUnique.mockResolvedValue(null);
      prisma.deployTarget.findUnique.mockResolvedValue(TARGET);
      prisma.projectBootstrapSecret.findUnique.mockResolvedValue({ encryptedPassword: 'enc-admin-password' });
      queueResults(ok(), failed(1));

      const result = await runner.execute(bootstrapContext());

      expect(result.errorMessage).toBe('Application admin bootstrap command failed');
      expect(prisma.projectBootstrapRun.upsert.mock.calls.map(([args]: any[]) => args.create.status)).toEqual([
        'RUNNING',
        'FAILED',
      ]);
    });
  });
});
