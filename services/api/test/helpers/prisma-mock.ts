export type MockPrismaService = {
  [K: string]: any;
  $transaction: jest.Mock;
  $queryRawUnsafe: jest.Mock;
};

export function createPrismaMock(): MockPrismaService {
  const mock: any = {
    $transaction: jest.fn().mockImplementation(async (fn: any) => fn(mock)),
    $queryRawUnsafe: jest.fn(),
  };

  const models = [
    'user', 'revokedRefreshToken', 'workspace', 'workspaceMember', 'invitation',
    'project', 'component', 'repositoryCredential', 'artifact',
    'environment', 'environmentVariable',
    'deployment', 'deploymentStageLog',
    'deployTarget', 'task',
    'testCase', 'testRun', 'testRunCase',
    'issue', 'release', 'gateExemption',
    'notification', 'auditLog',
  ];

  for (const model of models) {
    mock[model] = {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      upsert: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    };
  }

  return mock as MockPrismaService;
}
