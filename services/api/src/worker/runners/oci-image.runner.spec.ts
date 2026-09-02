/* eslint-disable @typescript-eslint/no-explicit-any */
import { OciImageRunner } from './oci-image.runner';
import { RunnerContext } from './runner.factory';

const FIXED_DIGEST = 'a'.repeat(64);
const FIXED_DIGEST_B = 'b'.repeat(64);
const FIXED_DIGEST_C = 'c'.repeat(64);

function makePrismaDouble() {
  const prisma: any = {
    deployment: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    artifact: {
      upsert: vi.fn(),
    },
  };
  return prisma;
}

function makeContext(over: Partial<RunnerContext> = {}): RunnerContext {
  return {
    taskType: 'PROJECT_IMAGE_PREPARE',
    refId: 'deploy-1',
    payload: {},
    ...over,
  };
}

function successUpsertFixture(prisma: any) {
  prisma.deployment.findUnique.mockResolvedValue({
    id: 'deploy-1',
    projectId: 'proj-1',
    commitSha: 'abc123',
    project: { imageReference: `registry.example.com/team/app:1.0.0@sha256:${FIXED_DIGEST}` },
  });
  prisma.artifact.upsert.mockResolvedValue({ id: 'artifact-1' });
  prisma.deployment.update.mockResolvedValue({ id: 'deploy-1' });
}

describe('OciImageRunner.execute - failure matrix (no upsert, no deployment update)', () => {
  it('returns the missing-reference failure when the deployment does not exist', async () => {
    const prisma = makePrismaDouble();
    prisma.deployment.findUnique.mockResolvedValue(null);
    const runner = new OciImageRunner(prisma);

    const result = await runner.execute(makeContext());

    expect(result).toEqual({
      success: false,
      stdout: '',
      stderr: 'OCI image reference is missing',
      exitCode: -1,
      errorMessage: 'OCI image reference is missing',
    });
    expect(prisma.artifact.upsert).not.toHaveBeenCalled();
    expect(prisma.deployment.update).not.toHaveBeenCalled();
  });

  it('returns the missing-reference failure when the deployment exists but project.imageReference is missing', async () => {
    const prisma = makePrismaDouble();
    prisma.deployment.findUnique.mockResolvedValue({
      id: 'deploy-1',
      projectId: 'proj-1',
      commitSha: 'abc123',
      project: { imageReference: null },
    });
    const runner = new OciImageRunner(prisma);

    const result = await runner.execute(makeContext());

    expect(result).toEqual({
      success: false,
      stdout: '',
      stderr: 'OCI image reference is missing',
      exitCode: -1,
      errorMessage: 'OCI image reference is missing',
    });
    expect(prisma.artifact.upsert).not.toHaveBeenCalled();
    expect(prisma.deployment.update).not.toHaveBeenCalled();
  });

  it('returns the missing-reference failure when imageReference is the empty string', async () => {
    const prisma = makePrismaDouble();
    prisma.deployment.findUnique.mockResolvedValue({
      id: 'deploy-1',
      projectId: 'proj-1',
      commitSha: 'abc123',
      project: { imageReference: '' },
    });
    const runner = new OciImageRunner(prisma);

    const result = await runner.execute(makeContext());

    expect(result).toEqual({
      success: false,
      stdout: '',
      stderr: 'OCI image reference is missing',
      exitCode: -1,
      errorMessage: 'OCI image reference is missing',
    });
    expect(prisma.artifact.upsert).not.toHaveBeenCalled();
  });

  it('returns the sha256-digest failure when only a tag is supplied (no @sha256)', async () => {
    const prisma = makePrismaDouble();
    prisma.deployment.findUnique.mockResolvedValue({
      id: 'deploy-1',
      projectId: 'proj-1',
      commitSha: 'abc123',
      project: { imageReference: 'registry.example.com/team/app:1.0.0' },
    });
    const runner = new OciImageRunner(prisma);

    const result = await runner.execute(makeContext());

    expect(result.success).toBe(false);
    expect(result.stdout).toBe('');
    expect(result.exitCode).toBe(-1);
    expect(result.errorMessage).toBe('OCI image must use a complete sha256 digest reference');
    expect(result.stderr).toBe('OCI image must use a complete sha256 digest reference');
    expect(prisma.artifact.upsert).not.toHaveBeenCalled();
    expect(prisma.deployment.update).not.toHaveBeenCalled();
  });

  it('returns the sha256-digest failure when the digest is 63 hex chars (too short)', async () => {
    const prisma = makePrismaDouble();
    prisma.deployment.findUnique.mockResolvedValue({
      id: 'deploy-1',
      projectId: 'proj-1',
      commitSha: 'abc123',
      project: { imageReference: `registry.example.com/team/app:1.0.0@sha256:${FIXED_DIGEST.slice(1)}` }, // 63 chars
    });
    const runner = new OciImageRunner(prisma);

    const result = await runner.execute(makeContext());

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('OCI image must use a complete sha256 digest reference');
    expect(prisma.artifact.upsert).not.toHaveBeenCalled();
  });

  it('returns the sha256-digest failure when the digest is 65 hex chars (too long)', async () => {
    const prisma = makePrismaDouble();
    prisma.deployment.findUnique.mockResolvedValue({
      id: 'deploy-1',
      projectId: 'proj-1',
      commitSha: 'abc123',
      project: { imageReference: `registry.example.com/team/app:1.0.0@sha256:${FIXED_DIGEST}f` }, // 65 chars
    });
    const runner = new OciImageRunner(prisma);

    const result = await runner.execute(makeContext());

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('OCI image must use a complete sha256 digest reference');
    expect(prisma.artifact.upsert).not.toHaveBeenCalled();
  });

  it('returns the sha256-digest failure when the digest contains a non-hex character (current behavior)', async () => {
    const prisma = makePrismaDouble();
    const badDigest = 'z'.repeat(64);
    prisma.deployment.findUnique.mockResolvedValue({
      id: 'deploy-1',
      projectId: 'proj-1',
      commitSha: 'abc123',
      project: { imageReference: `registry.example.com/team/app:1.0.0@${badDigest}` },
    });
    const runner = new OciImageRunner(prisma);

    const result = await runner.execute(makeContext());

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('OCI image must use a complete sha256 digest reference');
    expect(prisma.artifact.upsert).not.toHaveBeenCalled();
  });

  it('returns the sha256-digest failure when the image reference contains a space (current behavior)', async () => {
    const prisma = makePrismaDouble();
    prisma.deployment.findUnique.mockResolvedValue({
      id: 'deploy-1',
      projectId: 'proj-1',
      commitSha: 'abc123',
      project: { imageReference: `registry.example.com/team/app with space@sha256:${FIXED_DIGEST}` },
    });
    const runner = new OciImageRunner(prisma);

    const result = await runner.execute(makeContext());

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('OCI image must use a complete sha256 digest reference');
    expect(prisma.artifact.upsert).not.toHaveBeenCalled();
  });

  it('returns the sha256-digest failure when the image reference contains a shell metachar (current behavior)', async () => {
    const prisma = makePrismaDouble();
    prisma.deployment.findUnique.mockResolvedValue({
      id: 'deploy-1',
      projectId: 'proj-1',
      commitSha: 'abc123',
      project: { imageReference: `registry.example.com/team/app;rm -rf @sha256:${FIXED_DIGEST}` },
    });
    const runner = new OciImageRunner(prisma);

    const result = await runner.execute(makeContext());

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('OCI image must use a complete sha256 digest reference');
    expect(prisma.artifact.upsert).not.toHaveBeenCalled();
  });

  it('returns the sha256-digest failure when the digest is a non-sha256 algorithm (current behavior)', async () => {
    const prisma = makePrismaDouble();
    prisma.deployment.findUnique.mockResolvedValue({
      id: 'deploy-1',
      projectId: 'proj-1',
      commitSha: 'abc123',
      project: {
        imageReference: `registry.example.com/team/app:1.0.0@sha512:${FIXED_DIGEST}${FIXED_DIGEST.slice(0, 64)}`,
      },
    });
    const runner = new OciImageRunner(prisma);

    const result = await runner.execute(makeContext());

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('OCI image must use a complete sha256 digest reference');
    expect(prisma.artifact.upsert).not.toHaveBeenCalled();
  });
});

describe('OciImageRunner.execute - success matrix (artifact upsert + deployment update)', () => {
  it('upserts the artifact and updates the deployment for a fully valid registry/path@sha256 reference', async () => {
    const prisma = makePrismaDouble();
    successUpsertFixture(prisma);
    const runner = new OciImageRunner(prisma);

    const result = await runner.execute(makeContext());

    // artifact.upsert
    expect(prisma.artifact.upsert).toHaveBeenCalledTimes(1);
    const upsertArgs = prisma.artifact.upsert.mock.calls[0][0];
    expect(upsertArgs.where).toEqual({
      projectId_digest: { projectId: 'proj-1', digest: `sha256:${FIXED_DIGEST}` },
    });
    expect(upsertArgs.create).toEqual({
      deploymentId: 'deploy-1',
      projectId: 'proj-1',
      imageRef: 'registry.example.com/team/app:1.0.0',
      digest: `sha256:${FIXED_DIGEST}`,
      commitSha: 'abc123',
      sbomStatus: 'EXTERNAL',
    });
    expect(upsertArgs.update).toEqual({
      imageRef: 'registry.example.com/team/app:1.0.0',
      digest: `sha256:${FIXED_DIGEST}`,
      commitSha: 'abc123',
    });

    // deployment.update
    expect(prisma.deployment.update).toHaveBeenCalledTimes(1);
    expect(prisma.deployment.update).toHaveBeenCalledWith({
      where: { id: 'deploy-1' },
      data: { artifactId: 'artifact-1', artifactDigest: `sha256:${FIXED_DIGEST}` },
    });

    // success result
    expect(result).toEqual({
      success: true,
      stdout: `Using immutable OCI image registry.example.com/team/app:1.0.0@sha256:${FIXED_DIGEST}`,
      stderr: '',
      exitCode: 0,
      errorMessage: '',
    });
  });

  it('handles a registry reference with port, multi-segment path, and tag correctly', async () => {
    const prisma = makePrismaDouble();
    prisma.deployment.findUnique.mockResolvedValue({
      id: 'deploy-2',
      projectId: 'proj-7',
      commitSha: 'deadbeef',
      project: { imageReference: `registry.local:5000/org/team/sub/app:2.3.4-rc1@sha256:${FIXED_DIGEST_B}` },
    });
    prisma.artifact.upsert.mockResolvedValue({ id: 'artifact-2' });
    prisma.deployment.update.mockResolvedValue({ id: 'deploy-2' });
    const runner = new OciImageRunner(prisma);

    const result = await runner.execute(makeContext({ refId: 'deploy-2' }));

    const upsertArgs = prisma.artifact.upsert.mock.calls[0][0];
    expect(upsertArgs.where).toEqual({
      projectId_digest: { projectId: 'proj-7', digest: `sha256:${FIXED_DIGEST_B}` },
    });
    expect(upsertArgs.create).toEqual({
      deploymentId: 'deploy-2',
      projectId: 'proj-7',
      imageRef: 'registry.local:5000/org/team/sub/app:2.3.4-rc1',
      digest: `sha256:${FIXED_DIGEST_B}`,
      commitSha: 'deadbeef',
      sbomStatus: 'EXTERNAL',
    });
    expect(prisma.deployment.update).toHaveBeenCalledWith({
      where: { id: 'deploy-2' },
      data: { artifactId: 'artifact-2', artifactDigest: `sha256:${FIXED_DIGEST_B}` },
    });
    expect(result.success).toBe(true);
    expect(result.stdout).toContain('registry.local:5000/org/team/sub/app:2.3.4-rc1');
    expect(result.stdout).toContain(`sha256:${FIXED_DIGEST_B}`);
  });

  it('preserves an uppercase SHA256 digest in the parsed digest (current behavior, regex is case-insensitive)', async () => {
    const prisma = makePrismaDouble();
    const upper = 'A'.repeat(64);
    prisma.deployment.findUnique.mockResolvedValue({
      id: 'deploy-3',
      projectId: 'proj-9',
      commitSha: 'feedface',
      project: { imageReference: `registry.example.com/team/app@sha256:${upper}` },
    });
    prisma.artifact.upsert.mockResolvedValue({ id: 'artifact-3' });
    prisma.deployment.update.mockResolvedValue({ id: 'deploy-3' });
    const runner = new OciImageRunner(prisma);

    const result = await runner.execute(makeContext({ refId: 'deploy-3' }));

    const upsertArgs = prisma.artifact.upsert.mock.calls[0][0];
    expect(upsertArgs.create.digest).toBe(`sha256:${upper}`);
    expect(upsertArgs.create.imageRef).toBe('registry.example.com/team/app');
    expect(prisma.deployment.update).toHaveBeenCalledWith({
      where: { id: 'deploy-3' },
      data: { artifactId: 'artifact-3', artifactDigest: `sha256:${upper}` },
    });
    expect(result.success).toBe(true);
  });

  it('preserves a null commitSha end-to-end in the artifact and deployment update (current behavior)', async () => {
    const prisma = makePrismaDouble();
    prisma.deployment.findUnique.mockResolvedValue({
      id: 'deploy-4',
      projectId: 'proj-11',
      commitSha: null,
      project: { imageReference: `ghcr.io/team/app@sha256:${FIXED_DIGEST_C}` },
    });
    prisma.artifact.upsert.mockResolvedValue({ id: 'artifact-4' });
    prisma.deployment.update.mockResolvedValue({ id: 'deploy-4' });
    const runner = new OciImageRunner(prisma);

    const result = await runner.execute(makeContext({ refId: 'deploy-4' }));

    const upsertArgs = prisma.artifact.upsert.mock.calls[0][0];
    expect(upsertArgs.create.commitSha).toBeNull();
    expect(upsertArgs.update.commitSha).toBeNull();
    expect(prisma.deployment.update).toHaveBeenCalledWith({
      where: { id: 'deploy-4' },
      data: { artifactId: 'artifact-4', artifactDigest: `sha256:${FIXED_DIGEST_C}` },
    });
    expect(result.success).toBe(true);
  });
});

describe('OciImageRunner.execute - error propagation', () => {
  it('propagates the artifact.upsert error and does NOT update the deployment', async () => {
    const prisma = makePrismaDouble();
    successUpsertFixture(prisma);
    const err = new Error('unique violation on artifact.digest');
    prisma.artifact.upsert.mockRejectedValueOnce(err);
    const runner = new OciImageRunner(prisma);

    await expect(runner.execute(makeContext())).rejects.toBe(err);
    expect(prisma.deployment.update).not.toHaveBeenCalled();
  });

  it('upserts the artifact before propagating deployment.update failure (non-atomic current behavior)', async () => {
    const prisma = makePrismaDouble();
    successUpsertFixture(prisma);
    const err = new Error('deployment row locked');
    prisma.deployment.update.mockRejectedValueOnce(err);
    const runner = new OciImageRunner(prisma);

    await expect(runner.execute(makeContext())).rejects.toBe(err);
    expect(prisma.artifact.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.deployment.update).toHaveBeenCalledTimes(1);
    expect(prisma.artifact.upsert.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.deployment.update.mock.invocationCallOrder[0],
    );
  });

  it('propagates a deployment.findUnique error', async () => {
    const prisma = makePrismaDouble();
    const err = new Error('database connection lost');
    prisma.deployment.findUnique.mockRejectedValueOnce(err);
    const runner = new OciImageRunner(prisma);

    await expect(runner.execute(makeContext())).rejects.toBe(err);
    expect(prisma.artifact.upsert).not.toHaveBeenCalled();
    expect(prisma.deployment.update).not.toHaveBeenCalled();
  });
});
