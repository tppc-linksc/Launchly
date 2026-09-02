import { vi, type Mock } from 'vitest';

export type MockPrismaService = {
  [K: string]: any;
  $transaction: Mock;
  $queryRawUnsafe: Mock;
};

export function createPrismaMock(): MockPrismaService {
  const mock: any = {
    $transaction: vi.fn().mockImplementation(async (fn: any) => fn(mock)),
    $queryRawUnsafe: vi.fn(),
  };

  const models = [
    'user',
    'revokedRefreshToken',
    'workspace',
    'workspaceMember',
    'invitation',
    'project',
    'component',
    'repositoryCredential',
    'artifact',
    'environment',
    'environmentVariable',
    'deployment',
    'deploymentStageLog',
    'deployTarget',
    'task',
    'testCase',
    'testRun',
    'testRunCase',
    'issue',
    'release',
    'gateExemption',
    'notification',
    'auditLog',
  ];

  for (const model of models) {
    mock[model] = {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      upsert: vi.fn(),
      count: vi.fn(),
      aggregate: vi.fn(),
    };
  }

  return mock as MockPrismaService;
}
