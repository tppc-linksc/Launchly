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
    'user', 'workspace', 'workspaceMember', 'invitation',
    'project', 'component', 'repositoryCredential',
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
      delete: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    };
  }

  return mock as MockPrismaService;
}
