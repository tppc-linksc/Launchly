import { SecretRotationService } from './secret-rotation.service';

describe('SecretRotationService', () => {
  it('re-encrypts all workspace-owned secret stores in one transaction', async () => {
    const tx: any = {
      environmentVariable: {
        findMany: jest.fn().mockResolvedValue([{ id: 'env-secret', encryptedValue: 'old-env' }]),
        update: jest.fn(),
      },
      repositoryCredential: {
        findMany: jest.fn().mockResolvedValue([{ id: 'repo-secret', encryptedValue: 'old-repo' }]),
        update: jest.fn(),
      },
      deployTarget: {
        findMany: jest.fn().mockResolvedValue([{ id: 'target-secret', encryptedCredential: 'old-target' }]),
        update: jest.fn(),
      },
      projectBootstrapSecret: {
        findMany: jest.fn().mockResolvedValue([{ projectId: 'bootstrap-project', encryptedPassword: 'old-bootstrap' }]),
        update: jest.fn(),
      },
    };
    const prisma: any = { $transaction: jest.fn((callback: any) => callback(tx)) };
    const secrets: any = { reencrypt: jest.fn((value: string) => `new(${value})`) };
    const service = new SecretRotationService(prisma, secrets);

    await expect(service.rotate('workspace-a')).resolves.toEqual({ success: true, rotated: 4 });
    expect(tx.environmentVariable.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { environment: { project: { workspaceId: 'workspace-a' } } },
      }),
    );
    expect(tx.environmentVariable.update).toHaveBeenCalledWith({
      where: { id: 'env-secret' },
      data: { encryptedValue: 'new(old-env)' },
    });
    expect(tx.repositoryCredential.update).toHaveBeenCalledWith({
      where: { id: 'repo-secret' },
      data: { encryptedValue: 'new(old-repo)' },
    });
    expect(tx.deployTarget.update).toHaveBeenCalledWith({
      where: { id: 'target-secret' },
      data: { encryptedCredential: 'new(old-target)' },
    });
    expect(tx.projectBootstrapSecret.update).toHaveBeenCalledWith({
      where: { projectId: 'bootstrap-project' },
      data: { encryptedPassword: 'new(old-bootstrap)' },
    });
  });
});
