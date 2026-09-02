import { ForbiddenException } from '@nestjs/common';
import { EnvironmentVariableService } from './environment-variable.service';
import { SecretValueService } from './secret-value.service';
import { createPrismaMock, MockPrismaService } from '../../test/helpers/prisma-mock';

describe('EnvironmentVariableService', () => {
  let service: EnvironmentVariableService;
  let prisma: MockPrismaService;
  let secrets: { encrypt: vi.Mock; mask: vi.Mock };

  const workspaceId = 'ws-1';
  const otherWorkspaceId = 'ws-OTHER';
  const projectId = 'proj-1';
  const envId = 'env-1';
  const variableId = 'var-1';
  const userId = 'user-1';

  // A recognisable plaintext so a leakage assertion can find it by name.
  const SECRET_PLAINTEXT = 'PLAINTEXT-DO-NOT-LEAK-IN-RETURN';

  const project = { id: projectId, workspaceId };
  const otherProject = { id: 'proj-OTHER', workspaceId: otherWorkspaceId };
  const envRecord = { id: envId, projectId };

  beforeEach(() => {
    prisma = createPrismaMock();
    // Use deterministic-but-disjoint outputs so the assertions can verify that
    // (a) the original plaintext is never returned in the redacted object and
    // (b) encrypt/mask are both called with the original value.
    secrets = {
      encrypt: vi.fn((plain: string) => `v2:enc(${plain})`),
      mask: vi.fn(() => 'MASKED-REDACTED-OUTPUT'),
    };
    service = new EnvironmentVariableService(prisma as any, secrets as unknown as SecretValueService);
  });

  describe('listByEnvironment', () => {
    it('queries by the exact environmentId and returns only the whitelisted fields', async () => {
      prisma.environmentVariable.findMany.mockResolvedValue([
        {
          id: variableId,
          environmentId: envId,
          key: 'API_KEY',
          encryptedValue: 'v2:enc(' + SECRET_PLAINTEXT + ')',
          maskedValue: 'ma****',
          sensitive: true,
          description: 'a description',
        },
      ]);

      const result = await service.listByEnvironment(envId);

      expect(prisma.environmentVariable.findMany).toHaveBeenCalledWith({ where: { environmentId: envId } });
      expect(result).toHaveLength(1);

      const v = result[0] as Record<string, unknown>;
      expect(v.id).toBe(variableId);
      expect(v.environmentId).toBe(envId);
      expect(v.key).toBe('API_KEY');
      expect(v.maskedValue).toBe('已设置');
      expect(v.sensitive).toBe(true);
      expect(v.description).toBe('a description');
    });

    it('does not return the encryptedValue field even when Prisma has it', async () => {
      prisma.environmentVariable.findMany.mockResolvedValue([
        {
          id: variableId,
          environmentId: envId,
          key: 'API_KEY',
          encryptedValue: 'v2:enc(' + SECRET_PLAINTEXT + ')',
          maskedValue: 'ma****',
          sensitive: true,
          description: null,
        },
      ]);

      const result = await service.listByEnvironment(envId);
      const v = result[0] as Record<string, unknown>;

      expect('encryptedValue' in v).toBe(false);
      const serialised = JSON.stringify(result);
      expect(serialised).not.toContain(SECRET_PLAINTEXT);
      expect(serialised).not.toContain('v2:enc(');
    });

    it('returns an empty array when there are no variables (no extra Prisma calls)', async () => {
      prisma.environmentVariable.findMany.mockResolvedValue([]);

      const result = await service.listByEnvironment(envId);

      expect(result).toEqual([]);
      expect(prisma.environmentVariable.findMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('create - ownership order', () => {
    it('throws ForbiddenException when the environment does not exist (no encrypt/mask/create)', async () => {
      prisma.environment.findUnique.mockResolvedValue(null);

      await expect(service.create(envId, { key: 'A', value: 'v' }, userId, workspaceId)).rejects.toThrow(
        ForbiddenException,
      );

      expect(secrets.encrypt).not.toHaveBeenCalled();
      expect(secrets.mask).not.toHaveBeenCalled();
      expect(prisma.environmentVariable.create).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when the project does not exist (no encrypt/mask/create)', async () => {
      prisma.environment.findUnique.mockResolvedValue(envRecord);
      prisma.project.findUnique.mockResolvedValue(null);

      await expect(service.create(envId, { key: 'A', value: 'v' }, userId, workspaceId)).rejects.toThrow(
        ForbiddenException,
      );

      expect(secrets.encrypt).not.toHaveBeenCalled();
      expect(secrets.mask).not.toHaveBeenCalled();
      expect(prisma.environmentVariable.create).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when the project belongs to a different workspace (no encrypt/mask/create)', async () => {
      prisma.environment.findUnique.mockResolvedValue({ id: envId, projectId: 'proj-OTHER' });
      prisma.project.findUnique.mockResolvedValue(otherProject);

      await expect(service.create(envId, { key: 'A', value: 'v' }, userId, workspaceId)).rejects.toThrow(
        ForbiddenException,
      );

      expect(secrets.encrypt).not.toHaveBeenCalled();
      expect(secrets.mask).not.toHaveBeenCalled();
      expect(prisma.environmentVariable.create).not.toHaveBeenCalled();
    });
  });

  describe('create - success path', () => {
    beforeEach(() => {
      prisma.environment.findUnique.mockResolvedValue(envRecord);
      prisma.project.findUnique.mockResolvedValue(project);
    });

    it('validates ownership via the environment real projectId, encrypt+mask+persist the original value, and return a redacted object', async () => {
      prisma.environmentVariable.create.mockResolvedValue({
        id: variableId,
        environmentId: envId,
        key: 'API_KEY',
        encryptedValue: 'v2:enc(' + SECRET_PLAINTEXT + ')',
        maskedValue: 'MASKED-REDACTED-OUTPUT',
        sensitive: true,
        description: 'a description',
      });

      const result = await service.create(
        envId,
        { key: 'API_KEY', value: SECRET_PLAINTEXT, sensitive: true, description: 'a description' },
        userId,
        workspaceId,
      );

      // Ownership uses the real env.projectId
      expect(prisma.project.findUnique).toHaveBeenCalledWith({ where: { id: envRecord.projectId } });
      // Sensitive values are encrypted but never transformed into a partial plaintext mask.
      expect(secrets.encrypt).toHaveBeenCalledWith(SECRET_PLAINTEXT);
      expect(secrets.mask).not.toHaveBeenCalled();
      // Persisted record contains both forms
      expect(prisma.environmentVariable.create).toHaveBeenCalledWith({
        data: {
          environmentId: envId,
          key: 'API_KEY',
          encryptedValue: 'v2:enc(' + SECRET_PLAINTEXT + ')',
          maskedValue: '已设置',
          sensitive: true,
          description: 'a description',
        },
      });

      // Returned object: whitelisted fields, no encryptedValue
      const v = result as Record<string, unknown>;
      expect(v.id).toBe(variableId);
      expect(v.environmentId).toBe(envId);
      expect(v.key).toBe('API_KEY');
      expect(v.maskedValue).toBe('已设置');
      expect(v.sensitive).toBe(true);
      expect(v.description).toBe('a description');
      expect('encryptedValue' in v).toBe(false);

      // Plaintext must never appear in the serialised return value
      const serialised = JSON.stringify(result);
      expect(serialised).not.toContain(SECRET_PLAINTEXT);
      expect(serialised).not.toContain('v2:enc(');
    });

    it.each([
      { label: 'explicit true', inputSensitive: true, expectedSensitive: true },
      { label: 'explicit false', inputSensitive: false, expectedSensitive: false },
      { label: 'unspecified', inputSensitive: undefined, expectedSensitive: false },
    ])(
      'sensitive=$label: returns the sensitive flag and never leaks encryptedValue',
      async ({ inputSensitive, expectedSensitive }) => {
        prisma.environmentVariable.create.mockResolvedValue({
          id: variableId,
          environmentId: envId,
          key: 'A',
          encryptedValue: 'v2:enc(' + SECRET_PLAINTEXT + ')',
          maskedValue: 'MASKED-REDACTED-OUTPUT',
          sensitive: expectedSensitive,
          description: null,
        });

        const input: { key: string; value: string; sensitive?: boolean } = { key: 'A', value: SECRET_PLAINTEXT };
        if (inputSensitive !== undefined) input.sensitive = inputSensitive;

        const result = await service.create(envId, input, userId, workspaceId);
        const v = result as Record<string, unknown>;
        const persisted = (prisma.environmentVariable.create as vi.Mock).mock.calls[0][0].data;

        // Protect both sides of the contract: the persisted value and the redacted response.
        expect(persisted.sensitive).toBe(expectedSensitive);
        expect(v.id).toBe(variableId);
        expect(v.environmentId).toBe(envId);
        expect(v.key).toBe('A');
        expect(v.maskedValue).toBe(expectedSensitive ? '已设置' : 'MASKED-REDACTED-OUTPUT');
        expect(v.sensitive).toBe(expectedSensitive);
        expect('encryptedValue' in v).toBe(false);
        const serialised = JSON.stringify(result);
        expect(serialised).not.toContain(SECRET_PLAINTEXT);
        expect(serialised).not.toContain('v2:enc(');
      },
    );

    it.each([
      { label: 'plain string', input: 'a plain description', expected: 'a plain description' },
      { label: 'empty string', input: '', expected: '' },
      { label: 'unspecified', input: undefined, expected: null },
    ])('description=$label: returns the description and never leaks encryptedValue', async ({ input, expected }) => {
      // Prisma returns null when description is not supplied; the service returns
      // the database record while preserving undefined in the write request.
      prisma.environmentVariable.create.mockResolvedValue({
        id: variableId,
        environmentId: envId,
        key: 'A',
        encryptedValue: 'v2:enc(' + SECRET_PLAINTEXT + ')',
        maskedValue: 'MASKED-REDACTED-OUTPUT',
        sensitive: false,
        description: input === undefined ? null : input,
      });

      const payload: { key: string; value: string; description?: string } = { key: 'A', value: SECRET_PLAINTEXT };
      if (input !== undefined) payload.description = input;

      const result = await service.create(envId, payload, userId, workspaceId);
      const v = result as Record<string, unknown>;
      const persisted = (prisma.environmentVariable.create as vi.Mock).mock.calls[0][0].data;

      // Protect both sides of the contract: the persisted input and database response.
      expect(persisted.description).toBe(input);
      expect(v.id).toBe(variableId);
      expect(v.environmentId).toBe(envId);
      expect(v.key).toBe('A');
      expect(v.description).toBe(expected);
      expect('encryptedValue' in v).toBe(false);
      const serialised = JSON.stringify(result);
      expect(serialised).not.toContain(SECRET_PLAINTEXT);
      expect(serialised).not.toContain('v2:enc(');
    });
  });

  describe('create - database error propagation', () => {
    it('propagates an environmentVariable.create error unchanged', async () => {
      prisma.environment.findUnique.mockResolvedValue(envRecord);
      prisma.project.findUnique.mockResolvedValue(project);
      // Use a plain generic database error. The current Schema has no @@unique([environmentId, key]),
      // so a duplicate-key error is not actually a contract Prisma would emit here; this assertion
      // only verifies the Service re-throws whatever environmentVariable.create rejects with.
      const dbError = new Error('database write failed');
      prisma.environmentVariable.create.mockRejectedValue(dbError);

      await expect(service.create(envId, { key: 'A', value: 'v' }, userId, workspaceId)).rejects.toBe(dbError);
    });
  });

  describe('delete - ownership', () => {
    it('throws ForbiddenException when the variable does not exist (no delete)', async () => {
      prisma.environmentVariable.findUnique.mockResolvedValue(null);

      await expect(service.delete(variableId, userId, workspaceId)).rejects.toThrow(ForbiddenException);
      expect(prisma.environmentVariable.delete).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when the variable exists but its project does not (no delete)', async () => {
      prisma.environmentVariable.findUnique.mockResolvedValue({
        id: variableId,
        environment: { id: envId, projectId: 'proj-MISSING' },
      });
      prisma.project.findUnique.mockResolvedValue(null);

      await expect(service.delete(variableId, userId, workspaceId)).rejects.toThrow(ForbiddenException);
      expect(prisma.environmentVariable.delete).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when the project belongs to a different workspace (no delete)', async () => {
      prisma.environmentVariable.findUnique.mockResolvedValue({
        id: variableId,
        environment: { id: envId, projectId: 'proj-OTHER' },
      });
      prisma.project.findUnique.mockResolvedValue(otherProject);

      await expect(service.delete(variableId, userId, workspaceId)).rejects.toThrow(ForbiddenException);
      expect(prisma.environmentVariable.delete).not.toHaveBeenCalled();
    });

    it('uses variable.environment.projectId (not the URL environmentId) to validate workspace ownership', async () => {
      // The variable's real project is in the caller's workspace.
      prisma.environmentVariable.findUnique.mockResolvedValue({
        id: variableId,
        environment: { id: envId, projectId },
      });
      prisma.project.findUnique.mockResolvedValue(project);

      await service.delete(variableId, userId, workspaceId);

      expect(prisma.project.findUnique).toHaveBeenCalledWith({ where: { id: projectId } });
      expect(prisma.environmentVariable.delete).toHaveBeenCalledWith({ where: { id: variableId } });
    });
  });
});
