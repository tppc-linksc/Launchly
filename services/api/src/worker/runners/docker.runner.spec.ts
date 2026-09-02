/* eslint-disable @typescript-eslint/no-explicit-any */
import { DockerRunner } from './docker.runner';
import { RunnerContext } from './runner.factory';

function makeContext(over: Partial<RunnerContext> = {}): RunnerContext {
  return {
    taskType: 'DOCKER_BUILD',
    refId: 'deploy-1',
    payload: { image: 'nginx:1.25', workRoot: '/var/lib/launchly' },
    stageLogCallback: vi.fn(async () => undefined),
    ...over,
  };
}

describe('DockerRunner.execute - deliberate disabled result for every context', () => {
  it('returns the exact disabled result for a typical context', async () => {
    const runner = new DockerRunner();
    const ctx = makeContext();
    const result = await runner.execute(ctx);
    expect(result).toEqual({
      success: false,
      stdout: '',
      stderr: 'Legacy local Docker Runner is disabled. Bind a verified BYOS target instead.',
      exitCode: -1,
      errorMessage: 'Local Docker Runner is disabled by the control-plane isolation policy',
    });
  });

  it('returns the exact same disabled result for an empty context', async () => {
    const runner = new DockerRunner();
    const result = await runner.execute({} as RunnerContext);
    expect(result).toEqual({
      success: false,
      stdout: '',
      stderr: 'Legacy local Docker Runner is disabled. Bind a verified BYOS target instead.',
      exitCode: -1,
      errorMessage: 'Local Docker Runner is disabled by the control-plane isolation policy',
    });
  });

  it('does not vary the result for a context that includes deployTargetId (Docker is never used)', async () => {
    const runner = new DockerRunner();
    const ctx = makeContext({ payload: { deployTargetId: 'target-1' } });
    const result = await runner.execute(ctx);
    expect(result).toEqual({
      success: false,
      stdout: '',
      stderr: 'Legacy local Docker Runner is disabled. Bind a verified BYOS target instead.',
      exitCode: -1,
      errorMessage: 'Local Docker Runner is disabled by the control-plane isolation policy',
    });
  });

  it('does not vary the result for a context that simulates shell metacharacters in the payload', async () => {
    const runner = new DockerRunner();
    const ctx = makeContext({ payload: { image: 'evil; rm -rf $HOME `backtick` && curl bad.com' } });
    const result = await runner.execute(ctx);
    expect(result.success).toBe(false);
    expect(result.stdout).toBe('');
    expect(result.exitCode).toBe(-1);
    expect(result.errorMessage).toContain('control-plane isolation');
    expect(result.stderr).toContain('disabled');
  });

  it('does not call the stageLogCallback (no side effect on the worker pipeline)', async () => {
    const runner = new DockerRunner();
    const callback = vi.fn(async () => undefined);
    const ctx = makeContext({ stageLogCallback: callback });
    await runner.execute(ctx);
    expect(callback).not.toHaveBeenCalled();
  });

  it('returns a value whose stderr and errorMessage clearly document the control-plane isolation rationale', async () => {
    const runner = new DockerRunner();
    const result = await runner.execute(makeContext());
    expect(result.stderr).toMatch(/disabled/i);
    expect(result.errorMessage).toMatch(/control-plane isolation policy/i);
  });
});
