import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';

describe('AppModule production startup', () => {
  let app: INestApplication | undefined;
  let prismaMock: { $queryRawUnsafe: jest.Mock };
  let controllerNames: string[] = [];

  const originalEnv = {
    nodeEnv: process.env.NODE_ENV,
    processRole: process.env.LAUNCHLY_PROCESS_ROLE,
    jwtSecret: process.env.LAUNCHLY_JWT_SECRET,
    encryptionKey: process.env.LAUNCHLY_ENCRYPTION_KEY,
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'production';
    process.env.LAUNCHLY_PROCESS_ROLE = 'api';
    process.env.LAUNCHLY_JWT_SECRET = 'startup-smoke-jwt-secret';
    process.env.LAUNCHLY_ENCRYPTION_KEY = 'startup-smoke-encryption-key';

    const [{ Test }, { ModulesContainer }, { AppModule }, { PrismaService }] = await Promise.all([
      import('@nestjs/testing'),
      import('@nestjs/core'),
      import('../src/app.module'),
      import('../src/common/prisma/prisma.service'),
    ]);

    prismaMock = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ result: 1 }]),
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');

    const modules = app.get(ModulesContainer);
    controllerNames = [...modules.values()]
      .flatMap((module) => [...module.controllers.keys()])
      .map((controller) => (typeof controller === 'function' ? controller.name : String(controller)))
      .sort();
  });

  afterAll(async () => {
    await app?.close();
    restoreEnv('NODE_ENV', originalEnv.nodeEnv);
    restoreEnv('LAUNCHLY_PROCESS_ROLE', originalEnv.processRole);
    restoreEnv('LAUNCHLY_JWT_SECRET', originalEnv.jwtSecret);
    restoreEnv('LAUNCHLY_ENCRYPTION_KEY', originalEnv.encryptionKey);
  });

  it('creates every API controller without dependency-injection errors', () => {
    expect(app).toBeDefined();
    expect(controllerNames).toEqual([
      'AuditLogController',
      'AuthController',
      'ComponentController',
      'DeployTargetController',
      'DeploymentController',
      'EnvironmentController',
      'EnvironmentVariableController',
      'HealthController',
      'IssueController',
      'MemberController',
      'NotificationController',
      'ProjectController',
      'ReleaseController',
      'SetupController',
      'SystemController',
      'TestCaseController',
      'TestRunController',
      'WebhookController',
    ]);
  });

  it('serves the production health route with the database dependency isolated', async () => {
    const address = app!.getHttpServer().address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/api/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ok',
      database: 'ok',
      timestamp: expect.any(String),
    });
    expect(prismaMock.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    expect(prismaMock.$queryRawUnsafe).toHaveBeenCalledWith('SELECT 1');
  });
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
