/* eslint-disable @typescript-eslint/no-explicit-any */
import { RunnerFactory, RunnerContext, RunnerResult } from './runner.factory';

function buildFactory() {
  const unexpected = (name: string) => () => {
    throw new Error(`Unexpected runner call: ${name}`);
  };
  const gitRunner = { execute: vi.fn(unexpected('git')) } as any;
  const shellRunner = { execute: vi.fn(unexpected('shell')) } as any;
  const dockerRunner = { execute: vi.fn(unexpected('docker')) } as any;
  const remoteSshRunner = { execute: vi.fn(unexpected('remoteSsh')) } as any;
  const buildkitRunner = { execute: vi.fn(unexpected('buildkit')) } as any;
  const ociImageRunner = { execute: vi.fn(unexpected('ociImage')) } as any;
  const templateSourceRunner = { execute: vi.fn(unexpected('templateSource')) } as any;
  const factory = new RunnerFactory(
    gitRunner,
    shellRunner,
    dockerRunner,
    remoteSshRunner,
    buildkitRunner,
    ociImageRunner,
    templateSourceRunner,
  );
  return {
    factory,
    gitRunner,
    shellRunner,
    dockerRunner,
    remoteSshRunner,
    buildkitRunner,
    ociImageRunner,
    templateSourceRunner,
  };
}

const SAMPLE_RESULT: RunnerResult = {
  success: true,
  stdout: 'ok',
  stderr: '',
  exitCode: 0,
  errorMessage: '',
};

function makeContext(over: Partial<RunnerContext> = {}): RunnerContext {
  return {
    taskType: 'REPO_CLONE',
    refId: 'deploy-1',
    payload: { deployTargetId: 'target-1', note: 'unchanged' },
    stageLogCallback: vi.fn(async () => undefined),
    ...over,
  };
}

describe('RunnerFactory.execute - taskType routing matrix', () => {
  it('routes REPO_CLONE to GitRunner exactly once and skips every other runner', async () => {
    const {
      factory,
      gitRunner,
      shellRunner,
      dockerRunner,
      remoteSshRunner,
      buildkitRunner,
      ociImageRunner,
      templateSourceRunner,
    } = buildFactory();
    gitRunner.execute.mockResolvedValueOnce(SAMPLE_RESULT);
    const ctx = makeContext({ taskType: 'REPO_CLONE' });

    const result = await factory.execute('REPO_CLONE', ctx);

    expect(gitRunner.execute).toHaveBeenCalledTimes(1);
    expect(gitRunner.execute).toHaveBeenCalledWith(ctx);
    expect(shellRunner.execute).not.toHaveBeenCalled();
    expect(dockerRunner.execute).not.toHaveBeenCalled();
    expect(remoteSshRunner.execute).not.toHaveBeenCalled();
    expect(buildkitRunner.execute).not.toHaveBeenCalled();
    expect(ociImageRunner.execute).not.toHaveBeenCalled();
    expect(templateSourceRunner.execute).not.toHaveBeenCalled();
    expect(result).toBe(SAMPLE_RESULT);
  });

  it('routes PROJECT_BUILD to BuildkitRunner exactly once', async () => {
    const {
      factory,
      buildkitRunner,
      gitRunner,
      shellRunner,
      dockerRunner,
      remoteSshRunner,
      ociImageRunner,
      templateSourceRunner,
    } = buildFactory();
    buildkitRunner.execute.mockResolvedValueOnce(SAMPLE_RESULT);
    const ctx = makeContext({ taskType: 'PROJECT_BUILD' });

    const result = await factory.execute('PROJECT_BUILD', ctx);

    expect(buildkitRunner.execute).toHaveBeenCalledTimes(1);
    expect(buildkitRunner.execute).toHaveBeenCalledWith(ctx);
    expect(gitRunner.execute).not.toHaveBeenCalled();
    expect(shellRunner.execute).not.toHaveBeenCalled();
    expect(dockerRunner.execute).not.toHaveBeenCalled();
    expect(remoteSshRunner.execute).not.toHaveBeenCalled();
    expect(ociImageRunner.execute).not.toHaveBeenCalled();
    expect(templateSourceRunner.execute).not.toHaveBeenCalled();
    expect(result).toBe(SAMPLE_RESULT);
  });

  it('routes PROJECT_IMAGE_PREPARE to OciImageRunner exactly once', async () => {
    const {
      factory,
      ociImageRunner,
      gitRunner,
      shellRunner,
      dockerRunner,
      remoteSshRunner,
      buildkitRunner,
      templateSourceRunner,
    } = buildFactory();
    ociImageRunner.execute.mockResolvedValueOnce(SAMPLE_RESULT);
    const ctx = makeContext({ taskType: 'PROJECT_IMAGE_PREPARE' });

    const result = await factory.execute('PROJECT_IMAGE_PREPARE', ctx);

    expect(ociImageRunner.execute).toHaveBeenCalledTimes(1);
    expect(ociImageRunner.execute).toHaveBeenCalledWith(ctx);
    expect(gitRunner.execute).not.toHaveBeenCalled();
    expect(shellRunner.execute).not.toHaveBeenCalled();
    expect(dockerRunner.execute).not.toHaveBeenCalled();
    expect(remoteSshRunner.execute).not.toHaveBeenCalled();
    expect(buildkitRunner.execute).not.toHaveBeenCalled();
    expect(templateSourceRunner.execute).not.toHaveBeenCalled();
    expect(result).toBe(SAMPLE_RESULT);
  });

  it('routes TEMPLATE_SOURCE to TemplateSourceRunner exactly once', async () => {
    const {
      factory,
      templateSourceRunner,
      gitRunner,
      shellRunner,
      dockerRunner,
      remoteSshRunner,
      buildkitRunner,
      ociImageRunner,
    } = buildFactory();
    templateSourceRunner.execute.mockResolvedValueOnce(SAMPLE_RESULT);
    const ctx = makeContext({ taskType: 'TEMPLATE_SOURCE' });

    const result = await factory.execute('TEMPLATE_SOURCE', ctx);

    expect(templateSourceRunner.execute).toHaveBeenCalledTimes(1);
    expect(templateSourceRunner.execute).toHaveBeenCalledWith(ctx);
    expect(gitRunner.execute).not.toHaveBeenCalled();
    expect(shellRunner.execute).not.toHaveBeenCalled();
    expect(dockerRunner.execute).not.toHaveBeenCalled();
    expect(remoteSshRunner.execute).not.toHaveBeenCalled();
    expect(buildkitRunner.execute).not.toHaveBeenCalled();
    expect(ociImageRunner.execute).not.toHaveBeenCalled();
    expect(result).toBe(SAMPLE_RESULT);
  });

  it('routes PROJECT_DEPLOY with deployTargetId to RemoteSshRunner exactly once', async () => {
    const {
      factory,
      remoteSshRunner,
      gitRunner,
      shellRunner,
      dockerRunner,
      buildkitRunner,
      ociImageRunner,
      templateSourceRunner,
    } = buildFactory();
    remoteSshRunner.execute.mockResolvedValueOnce(SAMPLE_RESULT);
    const ctx = makeContext({ taskType: 'PROJECT_DEPLOY', payload: { deployTargetId: 'target-1' } });

    const result = await factory.execute('PROJECT_DEPLOY', ctx);

    expect(remoteSshRunner.execute).toHaveBeenCalledTimes(1);
    expect(remoteSshRunner.execute).toHaveBeenCalledWith(ctx);
    expect(gitRunner.execute).not.toHaveBeenCalled();
    expect(shellRunner.execute).not.toHaveBeenCalled();
    expect(dockerRunner.execute).not.toHaveBeenCalled();
    expect(buildkitRunner.execute).not.toHaveBeenCalled();
    expect(ociImageRunner.execute).not.toHaveBeenCalled();
    expect(templateSourceRunner.execute).not.toHaveBeenCalled();
    expect(result).toBe(SAMPLE_RESULT);
  });

  it('routes PROJECT_BOOTSTRAP with deployTargetId to RemoteSshRunner exactly once', async () => {
    const {
      factory,
      remoteSshRunner,
      gitRunner,
      shellRunner,
      dockerRunner,
      buildkitRunner,
      ociImageRunner,
      templateSourceRunner,
    } = buildFactory();
    remoteSshRunner.execute.mockResolvedValueOnce(SAMPLE_RESULT);
    const ctx = makeContext({ taskType: 'PROJECT_BOOTSTRAP', payload: { deployTargetId: 'target-1' } });

    const result = await factory.execute('PROJECT_BOOTSTRAP', ctx);

    expect(remoteSshRunner.execute).toHaveBeenCalledTimes(1);
    expect(remoteSshRunner.execute).toHaveBeenCalledWith(ctx);
    expect(gitRunner.execute).not.toHaveBeenCalled();
    expect(shellRunner.execute).not.toHaveBeenCalled();
    expect(dockerRunner.execute).not.toHaveBeenCalled();
    expect(buildkitRunner.execute).not.toHaveBeenCalled();
    expect(ociImageRunner.execute).not.toHaveBeenCalled();
    expect(templateSourceRunner.execute).not.toHaveBeenCalled();
    expect(result).toBe(SAMPLE_RESULT);
  });

  it('routes ROLLBACK_DEPLOY to RemoteSshRunner exactly once (no deployTargetId check)', async () => {
    const {
      factory,
      remoteSshRunner,
      gitRunner,
      shellRunner,
      dockerRunner,
      buildkitRunner,
      ociImageRunner,
      templateSourceRunner,
    } = buildFactory();
    remoteSshRunner.execute.mockResolvedValueOnce(SAMPLE_RESULT);
    const ctx = makeContext({ taskType: 'ROLLBACK_DEPLOY', payload: {} });

    const result = await factory.execute('ROLLBACK_DEPLOY', ctx);

    expect(remoteSshRunner.execute).toHaveBeenCalledTimes(1);
    expect(remoteSshRunner.execute).toHaveBeenCalledWith(ctx);
    expect(gitRunner.execute).not.toHaveBeenCalled();
    expect(shellRunner.execute).not.toHaveBeenCalled();
    expect(dockerRunner.execute).not.toHaveBeenCalled();
    expect(buildkitRunner.execute).not.toHaveBeenCalled();
    expect(ociImageRunner.execute).not.toHaveBeenCalled();
    expect(templateSourceRunner.execute).not.toHaveBeenCalled();
    expect(result).toBe(SAMPLE_RESULT);
  });

  it('routes HEALTH_CHECK to ShellRunner exactly once', async () => {
    const {
      factory,
      shellRunner,
      gitRunner,
      dockerRunner,
      remoteSshRunner,
      buildkitRunner,
      ociImageRunner,
      templateSourceRunner,
    } = buildFactory();
    shellRunner.execute.mockResolvedValueOnce(SAMPLE_RESULT);
    const ctx = makeContext({ taskType: 'HEALTH_CHECK' });

    const result = await factory.execute('HEALTH_CHECK', ctx);

    expect(shellRunner.execute).toHaveBeenCalledTimes(1);
    expect(shellRunner.execute).toHaveBeenCalledWith(ctx);
    expect(gitRunner.execute).not.toHaveBeenCalled();
    expect(dockerRunner.execute).not.toHaveBeenCalled();
    expect(remoteSshRunner.execute).not.toHaveBeenCalled();
    expect(buildkitRunner.execute).not.toHaveBeenCalled();
    expect(ociImageRunner.execute).not.toHaveBeenCalled();
    expect(templateSourceRunner.execute).not.toHaveBeenCalled();
    expect(result).toBe(SAMPLE_RESULT);
  });
});

describe('RunnerFactory.execute - no-route failure paths', () => {
  it('PROJECT_DEPLOY without deployTargetId: no runner called, returns complete unknown-task failure', async () => {
    const {
      factory,
      gitRunner,
      shellRunner,
      dockerRunner,
      remoteSshRunner,
      buildkitRunner,
      ociImageRunner,
      templateSourceRunner,
    } = buildFactory();
    const ctx = makeContext({ taskType: 'PROJECT_DEPLOY', payload: {} });

    const result = await factory.execute('PROJECT_DEPLOY', ctx);

    expect(result).toEqual({
      success: false,
      stdout: '',
      stderr: '',
      exitCode: -1,
      errorMessage: 'Unknown task type: PROJECT_DEPLOY',
    });
    expect(gitRunner.execute).not.toHaveBeenCalled();
    expect(shellRunner.execute).not.toHaveBeenCalled();
    expect(dockerRunner.execute).not.toHaveBeenCalled();
    expect(remoteSshRunner.execute).not.toHaveBeenCalled();
    expect(buildkitRunner.execute).not.toHaveBeenCalled();
    expect(ociImageRunner.execute).not.toHaveBeenCalled();
    expect(templateSourceRunner.execute).not.toHaveBeenCalled();
  });

  it('PROJECT_DEPLOY with empty-string deployTargetId: no runner called, returns complete failure (current behavior)', async () => {
    const {
      factory,
      gitRunner,
      shellRunner,
      dockerRunner,
      remoteSshRunner,
      buildkitRunner,
      ociImageRunner,
      templateSourceRunner,
    } = buildFactory();
    const ctx = makeContext({ taskType: 'PROJECT_DEPLOY', payload: { deployTargetId: '' } });

    const result = await factory.execute('PROJECT_DEPLOY', ctx);

    expect(result.success).toBe(false);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(-1);
    expect(result.errorMessage).toContain('Unknown task type: PROJECT_DEPLOY');
    expect(remoteSshRunner.execute).not.toHaveBeenCalled();
    expect(dockerRunner.execute).not.toHaveBeenCalled();
  });

  it('PROJECT_DEPLOY with null deployTargetId: no runner called, returns complete failure', async () => {
    const { factory, remoteSshRunner, dockerRunner } = buildFactory();
    const ctx = makeContext({ taskType: 'PROJECT_DEPLOY', payload: { deployTargetId: null } });

    const result = await factory.execute('PROJECT_DEPLOY', ctx);

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(-1);
    expect(result.errorMessage).toBe('Unknown task type: PROJECT_DEPLOY');
    expect(remoteSshRunner.execute).not.toHaveBeenCalled();
    expect(dockerRunner.execute).not.toHaveBeenCalled();
  });

  it('PROJECT_BOOTSTRAP without deployTargetId: no runner called, returns complete failure', async () => {
    const { factory, remoteSshRunner, dockerRunner } = buildFactory();
    const ctx = makeContext({ taskType: 'PROJECT_BOOTSTRAP', payload: {} });

    const result = await factory.execute('PROJECT_BOOTSTRAP', ctx);

    expect(result).toEqual({
      success: false,
      stdout: '',
      stderr: '',
      exitCode: -1,
      errorMessage: 'Unknown task type: PROJECT_BOOTSTRAP',
    });
    expect(remoteSshRunner.execute).not.toHaveBeenCalled();
    expect(dockerRunner.execute).not.toHaveBeenCalled();
  });

  it('completely unknown taskType: no runner called, errorMessage contains the exact taskType', async () => {
    const {
      factory,
      gitRunner,
      shellRunner,
      dockerRunner,
      remoteSshRunner,
      buildkitRunner,
      ociImageRunner,
      templateSourceRunner,
    } = buildFactory();
    const ctx = makeContext({ taskType: 'TOTALLY_MADE_UP_TYPE' });

    const result = await factory.execute('TOTALLY_MADE_UP_TYPE', ctx);

    expect(result).toEqual({
      success: false,
      stdout: '',
      stderr: '',
      exitCode: -1,
      errorMessage: 'Unknown task type: TOTALLY_MADE_UP_TYPE',
    });
    expect(gitRunner.execute).not.toHaveBeenCalled();
    expect(shellRunner.execute).not.toHaveBeenCalled();
    expect(dockerRunner.execute).not.toHaveBeenCalled();
    expect(remoteSshRunner.execute).not.toHaveBeenCalled();
    expect(buildkitRunner.execute).not.toHaveBeenCalled();
    expect(ociImageRunner.execute).not.toHaveBeenCalled();
    expect(templateSourceRunner.execute).not.toHaveBeenCalled();
  });

  it('PROJECT_DEPLOY with a null payload throws before routing (current behavior)', async () => {
    const {
      factory,
      gitRunner,
      shellRunner,
      dockerRunner,
      remoteSshRunner,
      buildkitRunner,
      ociImageRunner,
      templateSourceRunner,
    } = buildFactory();
    const ctx = makeContext({ taskType: 'PROJECT_DEPLOY', payload: null as any });

    await expect(factory.execute('PROJECT_DEPLOY', ctx)).rejects.toBeInstanceOf(TypeError);

    expect(gitRunner.execute).not.toHaveBeenCalled();
    expect(shellRunner.execute).not.toHaveBeenCalled();
    expect(dockerRunner.execute).not.toHaveBeenCalled();
    expect(remoteSshRunner.execute).not.toHaveBeenCalled();
    expect(buildkitRunner.execute).not.toHaveBeenCalled();
    expect(ociImageRunner.execute).not.toHaveBeenCalled();
    expect(templateSourceRunner.execute).not.toHaveBeenCalled();
  });
});

describe('RunnerFactory - DockerRunner is never routed (current isolation policy)', () => {
  it('every routed taskType except PROJECT_IMAGE_PREPARE does NOT touch DockerRunner', async () => {
    const {
      factory,
      dockerRunner,
      gitRunner,
      shellRunner,
      remoteSshRunner,
      buildkitRunner,
      ociImageRunner,
      templateSourceRunner,
    } = buildFactory();
    gitRunner.execute.mockResolvedValue(SAMPLE_RESULT);
    shellRunner.execute.mockResolvedValue(SAMPLE_RESULT);
    remoteSshRunner.execute.mockResolvedValue(SAMPLE_RESULT);
    buildkitRunner.execute.mockResolvedValue(SAMPLE_RESULT);
    ociImageRunner.execute.mockResolvedValue(SAMPLE_RESULT);
    templateSourceRunner.execute.mockResolvedValue(SAMPLE_RESULT);

    const cases: Array<[string, RunnerContext]> = [
      ['REPO_CLONE', makeContext({ taskType: 'REPO_CLONE' })],
      ['PROJECT_BUILD', makeContext({ taskType: 'PROJECT_BUILD' })],
      ['PROJECT_IMAGE_PREPARE', makeContext({ taskType: 'PROJECT_IMAGE_PREPARE' })],
      ['TEMPLATE_SOURCE', makeContext({ taskType: 'TEMPLATE_SOURCE' })],
      ['PROJECT_DEPLOY', makeContext({ taskType: 'PROJECT_DEPLOY', payload: { deployTargetId: 'tgt-1' } })],
      ['PROJECT_BOOTSTRAP', makeContext({ taskType: 'PROJECT_BOOTSTRAP', payload: { deployTargetId: 'tgt-1' } })],
      ['ROLLBACK_DEPLOY', makeContext({ taskType: 'ROLLBACK_DEPLOY' })],
      ['HEALTH_CHECK', makeContext({ taskType: 'HEALTH_CHECK' })],
    ];

    for (const [taskType, ctx] of cases) {
      await factory.execute(taskType, ctx);
    }

    expect(dockerRunner.execute).not.toHaveBeenCalled();
  });
});

describe('RunnerFactory - context pass-through and runner reject propagation', () => {
  it('passes the original context to the chosen runner without rewriting payload, refId, or callback', async () => {
    const { factory, gitRunner } = buildFactory();
    const ctx = makeContext({ taskType: 'REPO_CLONE', payload: { a: 1, deployTargetId: 'should-be-ignored' } });
    gitRunner.execute.mockResolvedValueOnce(SAMPLE_RESULT);

    await factory.execute('REPO_CLONE', ctx);

    const passed = gitRunner.execute.mock.calls[0][0];
    expect(passed).toBe(ctx); // same object identity
    expect(passed.payload).toEqual({ a: 1, deployTargetId: 'should-be-ignored' });
    expect(passed.refId).toBe('deploy-1');
    expect(passed.taskType).toBe('REPO_CLONE');
    expect(typeof passed.stageLogCallback).toBe('function');
  });

  it('propagates a runner rejection (remote-ssh) as the factory result; does not wrap or swallow', async () => {
    const { factory, remoteSshRunner } = buildFactory();
    const err = new Error('ssh agent unreachable');
    remoteSshRunner.execute.mockRejectedValueOnce(err);
    const ctx = makeContext({ taskType: 'ROLLBACK_DEPLOY' });

    await expect(factory.execute('ROLLBACK_DEPLOY', ctx)).rejects.toBe(err);
    expect(remoteSshRunner.execute).toHaveBeenCalledTimes(1);
  });

  it('propagates a runner thrown error (synchronous throw) as a rejection', async () => {
    const { factory, buildkitRunner } = buildFactory();
    const err = new Error('buildkit exploded before await');
    buildkitRunner.execute.mockImplementationOnce(() => {
      throw err;
    });
    const ctx = makeContext({ taskType: 'PROJECT_BUILD' });

    await expect(factory.execute('PROJECT_BUILD', ctx)).rejects.toBe(err);
  });

  it('does not return a successful result when a runner rejects', async () => {
    const { factory, ociImageRunner } = buildFactory();
    ociImageRunner.execute.mockRejectedValueOnce(new Error('oci failure'));
    const ctx = makeContext({ taskType: 'PROJECT_IMAGE_PREPARE' });

    await expect(factory.execute('PROJECT_IMAGE_PREPARE', ctx)).rejects.toThrow('oci failure');
  });
});
